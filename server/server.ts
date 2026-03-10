import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';
import os from 'os';

import {
  startGame,
  makePrediction,
  playCard as enginePlayCard,
  advanceToNextRound,
  getWinners,
  GameState,
} from '../src/game/engine';
import { botPrediction, botChooseCard, BotPublicState } from './botAI';

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const PORT = 3000;
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.use(express.static(path.join(__dirname, '../src/ui/multiplayer')));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HumanPlayer {
  kind: 'human';
  ws: WebSocket;
  id: string;
  name: string;
  isHost: boolean;
}

interface BotPlayer {
  kind: 'bot';
  id: string;
  name: string;
}

type RoomPlayer = HumanPlayer | BotPlayer;

function isBot(p: RoomPlayer): p is BotPlayer { return p.kind === 'bot'; }
function isHuman(p: RoomPlayer): p is HumanPlayer { return p.kind === 'human'; }

interface Room {
  maxPlayers: number;
  players: Map<string, RoomPlayer>;
  gameState: GameState | null;
  phase: 'lobby' | 'playing';
  botTurnTimer: ReturnType<typeof setTimeout> | null;
  /** True while showing the 5-second completed-trick preview to all players. */
  trickPreviewActive: boolean;
  /** Cumulative score snapshot at the end of each round (index 0 = round 1). */
  scoreHistory: Array<{ [playerId: string]: number }>;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let room: Room | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLocalIP(): string {
  for (const netList of Object.values(os.networkInterfaces())) {
    for (const net of netList ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function sendTo(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Broadcast only to human (WebSocket-connected) players. */
function broadcastHumans(msg: object, excludeId?: string): void {
  if (!room) return;
  for (const p of room.players.values()) {
    if (isHuman(p) && p.id !== excludeId) sendTo(p.ws, msg);
  }
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// Lobby broadcast
// ---------------------------------------------------------------------------

function broadcastLobbyState(): void {
  if (!room) return;
  const joinUrl = `http://${getLocalIP()}:${PORT}`;
  const canStart = room.players.size >= 2 && room.players.size === room.maxPlayers;

  const players = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    isBot: isBot(p),
    isHost: isHuman(p) && p.isHost,
  }));

  for (const p of room.players.values()) {
    if (isHuman(p)) {
      sendTo(p.ws, {
        type: 'lobby_update',
        maxPlayers: room.maxPlayers,
        currentCount: room.players.size,
        players,
        joinUrl,
        canStart,
        isHost: p.isHost,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Game state broadcast — each human gets only their own hand
// ---------------------------------------------------------------------------

function buildClientState(gs: GameState, forPlayerId: string) {
  const currentPlayerObj = gs.players[gs.currentPlayer];
  return {
    phase: gs.phase,
    roundNumber: gs.roundNumber,
    totalRounds: gs.totalRounds,
    cardsPerPlayer: gs.cardsPerPlayer,
    trumpSuit: gs.trumpSuit,
    currentPlayerId: currentPlayerObj?.id ?? null,
    leadSuit: gs.leadSuit,
    lastTrickWinnerId: gs.lastTrickWinnerId,
    lastTrickWinnerName: gs.lastTrickWinnerId
      ? (gs.players.find(p => p.id === gs.lastTrickWinnerId)?.name ?? null)
      : null,
    players: gs.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      predictedTricks: p.predictedTricks,
      tricksWon: p.tricksWon,
      handSize: p.hand.length,
      isBot: room?.players.get(p.id) ? isBot(room.players.get(p.id)!) : false,
      isHost: room?.players.get(p.id) && isHuman(room.players.get(p.id)!)
        ? (room.players.get(p.id) as HumanPlayer).isHost
        : false,
    })),
    yourHand: gs.players.find(p => p.id === forPlayerId)?.hand ?? [],
    trickCards: gs.trickCards.map(tc => ({
      playerId: tc.playerId,
      playerName: gs.players.find(p => p.id === tc.playerId)?.name ?? '?',
      card: tc.card,
    })),
    winners: gs.phase === 'game_over' ? getWinners(gs).map(p => p.name) : null,
    scoreHistory: room?.scoreHistory ?? [],
  };
}

function broadcastGameState(): void {
  if (!room?.gameState) return;
  for (const [id, p] of room.players) {
    if (isHuman(p)) sendTo(p.ws, { type: 'game_state', state: buildClientState(room.gameState, id) });
  }
  scheduleCheckBotTurn();
}

/** Broadcast a specific state snapshot without triggering bot scheduling. */
function broadcastStateSnapshot(gs: GameState): void {
  if (!room) return;
  for (const [id, p] of room.players) {
    if (isHuman(p)) sendTo(p.ws, { type: 'game_state', state: buildClientState(gs, id) });
  }
}

/**
 * Shared card-play handler for humans and bots.
 * When the last card of a trick is played, broadcasts a 5-second preview showing
 * all played cards before resolving. Returns an error string on failure, null on success.
 */
function processCardPlay(gs: GameState, cardId: string): string | null {
  if (!room) return 'Room not available';

  const isLastCardInTrick = gs.trickCards.length + 1 === gs.players.length;
  const playerIndex = gs.currentPlayer;
  const player = gs.players[playerIndex];

  const { state: resolvedState, error } = enginePlayCard(gs, cardId);
  if (error) return error;
  if (!room) return null;

  room.gameState = resolvedState;

  if (isLastCardInTrick) {
    // Build a preview state: all trick cards visible + winner info from the resolved state
    const playedCard = player.hand.find(c => c.id === cardId)!;
    const previewState: GameState = {
      ...gs,
      trickCards: [...gs.trickCards, { playerId: player.id, card: playedCard }],
      leadSuit: gs.leadSuit ?? playedCard.suit,
      // Include the winner ID so clients can display "X wins this trick!"
      lastTrickWinnerId: resolvedState.lastTrickWinnerId,
      players: gs.players.map((p, i) =>
        i === playerIndex ? { ...p, hand: p.hand.filter(c => c.id !== cardId) } : p
      ),
    };

    room.trickPreviewActive = true;
    broadcastStateSnapshot(previewState); // show complete trick for 5 seconds

    setTimeout(() => {
      if (!room) return;
      room.trickPreviewActive = false;
      if (room.gameState?.phase === 'round_end') captureRoundScores(room.gameState);
      broadcastGameState(); // broadcast actual resolved state + schedule any bot turns
    }, 5000);

  } else {
    if (resolvedState.phase === 'round_end') captureRoundScores(resolvedState);
    broadcastGameState();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Bot turn execution
// ---------------------------------------------------------------------------

function buildBotPublicState(gs: GameState): BotPublicState {
  return {
    players: gs.players.map(p => ({
      id: p.id,
      predictedTricks: p.predictedTricks,
      tricksWon: p.tricksWon,
      handSize: p.hand.length,
    })),
    cardsPerPlayer: gs.cardsPerPlayer,
    tricksPlayedThisRound: gs.tricksPlayedThisRound,
    trumpSuit: gs.trumpSuit,
    leadSuit: gs.leadSuit,
    trickCards: gs.trickCards,
  };
}

function scheduleCheckBotTurn(): void {
  if (!room) return;
  if (room.botTurnTimer) clearTimeout(room.botTurnTimer);
  // Stagger bot actions: 900ms–1500ms so they feel like thinking
  const delay = 900 + Math.floor(Math.random() * 600);
  room.botTurnTimer = setTimeout(() => {
    if (room) room.botTurnTimer = null;
    checkAndExecuteBotTurn();
  }, delay);
}

function checkAndExecuteBotTurn(): void {
  if (!room?.gameState) return;
  if (room.trickPreviewActive) return; // wait for the 5s preview to finish
  const gs = room.gameState;
  if (gs.phase !== 'prediction' && gs.phase !== 'playing') return;

  const currentGamePlayer = gs.players[gs.currentPlayer];
  const roomPlayer = room.players.get(currentGamePlayer.id);
  if (!roomPlayer || isHuman(roomPlayer)) return; // not a bot's turn

  const publicState = buildBotPublicState(gs);

  if (gs.phase === 'prediction') {
    const pred = botPrediction(currentGamePlayer.hand, publicState, currentGamePlayer.id);
    const { state, error } = makePrediction(gs, pred);
    if (!error && room) {
      room.gameState = state;
      if (state.phase === 'round_end') captureRoundScores(state);
      broadcastGameState();
    }
  } else if (gs.phase === 'playing') {
    const cardId = botChooseCard(currentGamePlayer.hand, publicState, currentGamePlayer.id);
    processCardPlay(gs, cardId); // handles trick preview + broadcast
  }
}

// ---------------------------------------------------------------------------
// Round score capture (called before broadcasting round_end state)
// ---------------------------------------------------------------------------

function captureRoundScores(gs: GameState): void {
  if (!room) return;
  const roundIdx = gs.roundNumber - 1;
  if (room.scoreHistory.length > roundIdx) return; // already captured this round
  const snapshot: { [playerId: string]: number } = {};
  for (const p of gs.players) snapshot[p.id] = p.score;
  room.scoreHistory.push(snapshot);
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

wss.on('connection', (ws) => {
  let myId: string | null = null;

  // Tell new connection the current room status
  if (!room) {
    sendTo(ws, { type: 'room_status', status: 'no_room' });
  } else if (room.phase === 'playing') {
    sendTo(ws, { type: 'room_status', status: 'in_progress' });
  } else if (room.players.size >= room.maxPlayers) {
    sendTo(ws, { type: 'room_status', status: 'full' });
  } else {
    sendTo(ws, {
      type: 'room_status', status: 'open',
      currentCount: room.players.size,
      maxPlayers: room.maxPlayers,
    });
  }

  ws.on('message', (data) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // ── Host ────────────────────────────────────────────────────────────────
    if (msg.type === 'host') {
      if (room) {
        sendTo(ws, { type: 'error', message: 'A game is already being hosted on this server.' });
        return;
      }
      const maxPlayers = Math.min(10, Math.max(2, Number(msg.maxPlayers) || 4));
      myId = generateId();
      room = {
        maxPlayers,
        players: new Map(),
        gameState: null,
        phase: 'lobby',
        botTurnTimer: null,
        trickPreviewActive: false,
        scoreHistory: [],
      };
      room.players.set(myId, { kind: 'human', ws, id: myId, name: String(msg.name).trim() || 'Host', isHost: true });
      sendTo(ws, { type: 'joined', playerId: myId, isHost: true });
      broadcastLobbyState();
    }

    // ── Join ────────────────────────────────────────────────────────────────
    else if (msg.type === 'join') {
      if (!room) { sendTo(ws, { type: 'error', message: 'No game is currently being hosted.' }); return; }
      if (room.phase === 'playing') { sendTo(ws, { type: 'error', message: 'Game already started.' }); return; }
      if (room.players.size >= room.maxPlayers) { sendTo(ws, { type: 'error', message: 'The room is full.' }); return; }
      myId = generateId();
      room.players.set(myId, { kind: 'human', ws, id: myId, name: String(msg.name).trim() || 'Player', isHost: false });
      sendTo(ws, { type: 'joined', playerId: myId, isHost: false });
      broadcastLobbyState();
    }

    // ── Add bot ─────────────────────────────────────────────────────────────
    else if (msg.type === 'add_bot') {
      if (!room || !myId) return;
      const me = room.players.get(myId);
      if (!me || isBot(me) || !me.isHost) { sendTo(ws, { type: 'error', message: 'Only the host can add bots.' }); return; }
      if (room.players.size >= room.maxPlayers) { sendTo(ws, { type: 'error', message: 'Room is full.' }); return; }
      const botNum = Array.from(room.players.values()).filter(isBot).length + 1;
      const botId = generateId();
      room.players.set(botId, { kind: 'bot', id: botId, name: `Bot ${botNum}` });
      broadcastLobbyState();
    }

    // ── Remove bot ──────────────────────────────────────────────────────────
    else if (msg.type === 'remove_bot') {
      if (!room || !myId) return;
      const me = room.players.get(myId);
      if (!me || isBot(me) || !me.isHost) { sendTo(ws, { type: 'error', message: 'Only the host can remove bots.' }); return; }
      const target = room.players.get(String(msg.botId));
      if (target && isBot(target)) {
        room.players.delete(target.id);
        broadcastLobbyState();
      }
    }

    // ── Start game ───────────────────────────────────────────────────────────
    else if (msg.type === 'start_game') {
      if (!room || !myId) return;
      const me = room.players.get(myId);
      if (!me || isBot(me) || !me.isHost) { sendTo(ws, { type: 'error', message: 'Only the host can start.' }); return; }
      if (room.players.size < 2) { sendTo(ws, { type: 'error', message: 'Need at least 2 players.' }); return; }
      if (room.players.size < room.maxPlayers) { sendTo(ws, { type: 'error', message: 'Not all slots are filled yet.' }); return; }

      const allPlayers = Array.from(room.players.values());
      const playerNames = allPlayers.map(p => p.name);

      let gs = startGame({ playerNames, seed: Date.now() });

      // Remap engine-generated IDs to actual room player IDs
      gs = {
        ...gs,
        players: gs.players.map((p, i) => ({ ...p, id: allPlayers[i].id })),
      };

      room.gameState = gs;
      room.phase = 'playing';
      room.scoreHistory = [];

      broadcastHumans({ type: 'game_started' });
      setTimeout(() => broadcastGameState(), 50);
    }

    // ── Predict ──────────────────────────────────────────────────────────────
    else if (msg.type === 'predict') {
      if (!room?.gameState || !myId) return;
      const gs = room.gameState;
      if (gs.players[gs.currentPlayer].id !== myId) {
        sendTo(ws, { type: 'error', message: "It's not your turn to predict." }); return;
      }
      const { state, error } = makePrediction(gs, Number(msg.value));
      if (error) { sendTo(ws, { type: 'error', message: error }); return; }
      room.gameState = state;
      if (state.phase === 'round_end') captureRoundScores(state);
      broadcastGameState();
    }

    // ── Start next round (host only) ─────────────────────────────────────────
    else if (msg.type === 'start_next_round') {
      if (!room?.gameState || !myId) return;
      const me = room.players.get(myId);
      if (!me || isBot(me) || !me.isHost) { sendTo(ws, { type: 'error', message: 'Only the host can start the next round.' }); return; }
      if (room.gameState.phase !== 'round_end') return;
      room.gameState = advanceToNextRound(room.gameState);
      broadcastGameState();
    }

    // ── Play card ─────────────────────────────────────────────────────────────
    else if (msg.type === 'play_card') {
      if (!room?.gameState || !myId) return;
      if (room.trickPreviewActive) {
        sendTo(ws, { type: 'error', message: 'Please wait for the trick to finish.' }); return;
      }
      const gs = room.gameState;
      if (gs.players[gs.currentPlayer].id !== myId) {
        sendTo(ws, { type: 'error', message: "It's not your turn." }); return;
      }
      const err = processCardPlay(gs, String(msg.cardId));
      if (err) sendTo(ws, { type: 'error', message: err });
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  ws.on('close', () => {
    if (!myId || !room) return;
    const leaving = room.players.get(myId);
    if (!leaving) return;

    room.players.delete(myId);

    const humanCount = Array.from(room.players.values()).filter(isHuman).length;
    if (humanCount === 0) {
      // No humans left — tear down room
      if (room.botTurnTimer) clearTimeout(room.botTurnTimer);
      room = null;
      return;
    }

    if (room.phase === 'lobby') {
      // Transfer host if host left
      if (isHuman(leaving) && leaving.isHost) {
        const newHost = Array.from(room.players.values()).find(isHuman) as HumanPlayer | undefined;
        if (newHost) newHost.isHost = true;
      }
      broadcastLobbyState();
    } else {
      broadcastHumans({ type: 'player_disconnected', playerName: leaving.name });
    }
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  console.log('\n  Judgement Card Game Server');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIP}:${PORT}`);
  console.log('\n  Share the Network URL with other players on the same WiFi.\n');
});
