import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import path from 'path';

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

const PORT = parseInt(process.env.PORT ?? '3000');
const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// process.cwd() is always the project root whether running via ts-node or compiled node
app.use('/assets', express.static(path.join(process.cwd(), 'assets')));
app.use(express.static(path.join(process.cwd(), 'src/ui/multiplayer')));

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
  code: string;
  maxPlayers: number;
  initialCards: number;
  numRounds: number;
  players: Map<string, RoomPlayer>;
  gameState: GameState | null;
  phase: 'lobby' | 'playing';
  botTurnTimer: ReturnType<typeof setTimeout> | null;
  /** True while showing the 5-second completed-trick preview to all players. */
  trickPreviewActive: boolean;
  /** Cumulative score snapshot at the end of each round (index 0 = round 1). */
  scoreHistory: Array<{ [playerId: string]: number }>;
  /** Pending cleanup timer — set when lobby empties, cancelled on reconnect. */
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  /** Players who disconnected mid-game; bot covers their turns until they return or timer fires. */
  disconnectedGamePlayers: Map<string, {
    name: string;
    isHost: boolean;
    killTimer: ReturnType<typeof setTimeout>;
  }>;
}

// ---------------------------------------------------------------------------
// State — all active rooms keyed by their 4-char code
// ---------------------------------------------------------------------------

const rooms = new Map<string, Room>();

// ---------------------------------------------------------------------------
// Player Registry — persistent identity: machineId → player name
// ---------------------------------------------------------------------------

const playerRegistry = new Map<string, string>(); // machineId → registered name
const takenNames     = new Set<string>();          // lowercase names in use

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique 4-character room code (unambiguous charset: no O/0, I/1/L). */
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code: string;
  do {
    code = Array.from({ length: 4 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

function sendTo(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Broadcast to all human players in a room. */
function broadcastHumans(room: Room, msg: object, excludeId?: string): void {
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

function broadcastLobbyState(room: Room): void {
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
        roomCode: room.code,
        maxPlayers: room.maxPlayers,
        initialCards: room.initialCards,
        numRounds: room.numRounds,
        currentCount: room.players.size,
        players,
        canStart,
        isHost: p.isHost,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Game state broadcast — each human gets only their own hand
// ---------------------------------------------------------------------------

function buildClientState(room: Room, gs: GameState, forPlayerId: string) {
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
      isBot: room.players.get(p.id) ? isBot(room.players.get(p.id)!) : false,
      isHost: room.players.get(p.id) && isHuman(room.players.get(p.id)!)
        ? (room.players.get(p.id) as HumanPlayer).isHost
        : (room.disconnectedGamePlayers.get(p.id)?.isHost ?? false),
      online: !room.disconnectedGamePlayers.has(p.id),
    })),
    yourHand: gs.players.find(p => p.id === forPlayerId)?.hand ?? [],
    trickCards: gs.trickCards.map(tc => ({
      playerId: tc.playerId,
      playerName: gs.players.find(p => p.id === tc.playerId)?.name ?? '?',
      card: tc.card,
    })),
    winners: gs.phase === 'game_over' ? getWinners(gs).map(p => p.name) : null,
    scoreHistory: room.scoreHistory,
  };
}

function broadcastGameState(room: Room): void {
  if (!room.gameState) return;
  for (const [id, p] of room.players) {
    if (isHuman(p)) sendTo(p.ws, { type: 'game_state', state: buildClientState(room, room.gameState, id) });
  }
  scheduleCheckBotTurn(room);
}

/** Broadcast a specific state snapshot without triggering bot scheduling. */
function broadcastStateSnapshot(room: Room, gs: GameState): void {
  for (const [id, p] of room.players) {
    if (isHuman(p)) sendTo(p.ws, { type: 'game_state', state: buildClientState(room, gs, id) });
  }
}

/**
 * Shared card-play handler for humans and bots.
 * When the last card of a trick is played, broadcasts a 5-second preview showing
 * all played cards before resolving. Returns an error string on failure, null on success.
 */
function processCardPlay(room: Room, gs: GameState, cardId: string): string | null {
  const isLastCardInTrick = gs.trickCards.length + 1 === gs.players.length;
  const playerIndex = gs.currentPlayer;
  const player = gs.players[playerIndex];

  const { state: resolvedState, error } = enginePlayCard(gs, cardId);
  if (error) return error;

  room.gameState = resolvedState;

  if (isLastCardInTrick) {
    const playedCard = player.hand.find(c => c.id === cardId)!;
    const previewState: GameState = {
      ...gs,
      trickCards: [...gs.trickCards, { playerId: player.id, card: playedCard }],
      leadSuit: gs.leadSuit ?? playedCard.suit,
      lastTrickWinnerId: resolvedState.lastTrickWinnerId,
      players: gs.players.map((p, i) =>
        i === playerIndex ? { ...p, hand: p.hand.filter(c => c.id !== cardId) } : p
      ),
    };

    room.trickPreviewActive = true;
    broadcastStateSnapshot(room, previewState);

    setTimeout(() => {
      if (!rooms.has(room.code)) return; // room was torn down
      room.trickPreviewActive = false;
      if (room.gameState?.phase === 'round_end') captureRoundScores(room, room.gameState);
      broadcastGameState(room);
    }, 5000);

  } else {
    if (resolvedState.phase === 'round_end') captureRoundScores(room, resolvedState);
    broadcastGameState(room);
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

function scheduleCheckBotTurn(room: Room): void {
  if (room.botTurnTimer) clearTimeout(room.botTurnTimer);
  const delay = 900 + Math.floor(Math.random() * 600);
  room.botTurnTimer = setTimeout(() => {
    room.botTurnTimer = null;
    checkAndExecuteBotTurn(room);
  }, delay);
}

function checkAndExecuteBotTurn(room: Room): void {
  if (!room.gameState) return;
  if (room.trickPreviewActive) return;
  const gs = room.gameState;
  if (gs.phase !== 'prediction' && gs.phase !== 'playing') return;

  const currentGamePlayer = gs.players[gs.currentPlayer];
  const roomPlayer = room.players.get(currentGamePlayer.id);
  const isDisconnected = room.disconnectedGamePlayers.has(currentGamePlayer.id);
  // Live human turn — do nothing; bot handles bots and disconnected humans
  if (roomPlayer && isHuman(roomPlayer)) return;
  if (!roomPlayer && !isDisconnected) return; // unknown player, skip

  const publicState = buildBotPublicState(gs);

  if (gs.phase === 'prediction') {
    const pred = botPrediction(currentGamePlayer.hand, publicState, currentGamePlayer.id);
    const { state, error } = makePrediction(gs, pred);
    if (!error) {
      room.gameState = state;
      if (state.phase === 'round_end') captureRoundScores(room, state);
      broadcastGameState(room);
    }
  } else if (gs.phase === 'playing') {
    const cardId = botChooseCard(currentGamePlayer.hand, publicState, currentGamePlayer.id);
    processCardPlay(room, gs, cardId);
  }
}

// ---------------------------------------------------------------------------
// Round score capture
// ---------------------------------------------------------------------------

function captureRoundScores(room: Room, gs: GameState): void {
  const roundIdx = gs.roundNumber - 1;
  if (room.scoreHistory.length > roundIdx) return;
  const snapshot: { [playerId: string]: number } = {};
  for (const p of gs.players) snapshot[p.id] = p.score;
  room.scoreHistory.push(snapshot);
}

// ---------------------------------------------------------------------------
// WebSocket handler
// ---------------------------------------------------------------------------

wss.on('connection', (ws) => {
  let myId: string | null = null;
  let myCode: string | null = null;

  ws.on('message', (data) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // ── Lookup — has this machine registered a name? ─────────────────────────
    if (msg.type === 'lookup') {
      const machineId = String(msg.machineId ?? '').trim();
      sendTo(ws, { type: 'lookup_result', name: playerRegistry.get(machineId) ?? null });
      return;
    }

    // ── Register — claim a unique player name for this machine ───────────────
    if (msg.type === 'register') {
      const machineId = String(msg.machineId ?? '').trim();
      const newName   = String(msg.name ?? '').trim().slice(0, 20);
      if (!machineId || !newName) { sendTo(ws, { type: 'register_error', message: 'Invalid data.' }); return; }
      const existingName = playerRegistry.get(machineId);
      if (existingName === newName) { sendTo(ws, { type: 'registered', name: newName }); return; }
      if (takenNames.has(newName.toLowerCase())) {
        sendTo(ws, { type: 'register_error', message: `"${newName}" is already taken. Please choose another name.` });
        return;
      }
      if (existingName) takenNames.delete(existingName.toLowerCase());
      playerRegistry.set(machineId, newName);
      takenNames.add(newName.toLowerCase());
      sendTo(ws, { type: 'registered', name: newName });
      return;
    }

    // ── Host ────────────────────────────────────────────────────────────────
    if (msg.type === 'host') {
      if (myCode) { sendTo(ws, { type: 'error', message: 'Already in a room.' }); return; }
      const maxPlayers = Math.min(10, Math.max(2, Number(msg.maxPlayers) || 4));
      const maxInitialCards = Math.min(13, Math.floor(52 / maxPlayers));
      const initialCards = Math.min(maxInitialCards, Math.max(2, Number(msg.initialCards) || 2));
      const maxRounds = 2 * initialCards - 1;
      const numRounds = Math.min(maxRounds, Math.max(1, Number(msg.numRounds) || maxRounds));
      const code = generateRoomCode();
      myId = generateId();
      myCode = code;
      const newRoom: Room = {
        code,
        maxPlayers,
        initialCards,
        numRounds,
        players: new Map(),
        gameState: null,
        phase: 'lobby',
        botTurnTimer: null,
        trickPreviewActive: false,
        scoreHistory: [],
        cleanupTimer: null,
        disconnectedGamePlayers: new Map(),
      };
      newRoom.players.set(myId, { kind: 'human', ws, id: myId, name: String(msg.name).trim() || 'Host', isHost: true });
      rooms.set(code, newRoom);
      sendTo(ws, { type: 'joined', playerId: myId, isHost: true, roomCode: code });
      broadcastLobbyState(newRoom);
    }

    // ── Join ────────────────────────────────────────────────────────────────
    else if (msg.type === 'join') {
      if (myCode) { sendTo(ws, { type: 'error', message: 'Already in a room.' }); return; }
      const code = String(msg.code ?? '').toUpperCase().trim();
      if (code.length !== 4) { sendTo(ws, { type: 'error', message: 'Please enter a 4-character room code.' }); return; }
      const targetRoom = rooms.get(code);
      if (!targetRoom) { sendTo(ws, { type: 'error', message: `No room found with code "${code}".` }); return; }
      if (targetRoom.phase === 'playing') {
        // Allow rejoining if this player (matched by name) disconnected mid-game
        const joinName = String(msg.name ?? '').trim();
        let matchId: string | null = null;
        let matchData: { name: string; isHost: boolean; killTimer: ReturnType<typeof setTimeout> } | null = null;
        for (const [pid, data] of targetRoom.disconnectedGamePlayers) {
          if (data.name.toLowerCase() === joinName.toLowerCase()) { matchId = pid; matchData = data; break; }
        }
        if (!matchId || !matchData) { sendTo(ws, { type: 'error', message: 'That game has already started.' }); return; }
        clearTimeout(matchData.killTimer);
        targetRoom.disconnectedGamePlayers.delete(matchId);
        myId = matchId; myCode = code;
        targetRoom.players.set(myId, { kind: 'human', ws, id: myId, name: matchData.name, isHost: matchData.isHost });
        sendTo(ws, { type: 'game_rejoined', playerId: myId, isHost: matchData.isHost, roomCode: code });
        if (targetRoom.gameState) sendTo(ws, { type: 'game_state', state: buildClientState(targetRoom, targetRoom.gameState, myId) });
        broadcastGameState(targetRoom);
        return;
      }
      if (targetRoom.players.size >= targetRoom.maxPlayers) { sendTo(ws, { type: 'error', message: 'That room is full.' }); return; }
      myId = generateId();
      myCode = code;
      targetRoom.players.set(myId, { kind: 'human', ws, id: myId, name: String(msg.name).trim() || 'Player', isHost: false });
      sendTo(ws, { type: 'joined', playerId: myId, isHost: false, roomCode: code });
      broadcastLobbyState(targetRoom);
    }

    // ── Reconnect (player returning after mobile app-switch) ────────────────
    else if (msg.type === 'reconnect') {
      if (myCode) return; // already in a room
      const code = String(msg.code ?? '').toUpperCase().trim();
      const prevId = String(msg.playerId ?? '');
      const targetRoom = rooms.get(code);
      if (!targetRoom) { sendTo(ws, { type: 'reconnect_failed' }); return; }

      // ── In-game reconnect ─────────────────────────────────────────────────
      if (targetRoom.phase === 'playing') {
        const disconnected = targetRoom.disconnectedGamePlayers.get(prevId);
        if (!disconnected) { sendTo(ws, { type: 'reconnect_failed' }); return; }
        clearTimeout(disconnected.killTimer);
        targetRoom.disconnectedGamePlayers.delete(prevId);
        myId = prevId;
        myCode = code;
        targetRoom.players.set(myId, { kind: 'human', ws, id: myId, name: disconnected.name, isHost: disconnected.isHost });
        sendTo(ws, { type: 'game_rejoined', playerId: myId, isHost: disconnected.isHost, roomCode: code });
        if (targetRoom.gameState) sendTo(ws, { type: 'game_state', state: buildClientState(targetRoom, targetRoom.gameState, myId) });
        broadcastGameState(targetRoom); // refresh online indicators
        return;
      }

      // ── Lobby reconnect ───────────────────────────────────────────────────
      if (targetRoom.cleanupTimer) { clearTimeout(targetRoom.cleanupTimer); targetRoom.cleanupTimer = null; }
      const hasHost = Array.from(targetRoom.players.values()).some(p => isHuman(p) && (p as HumanPlayer).isHost);
      const isHostClaim = msg.isHost === true && !hasHost;
      myId = prevId || generateId();
      myCode = code;
      const name = String(msg.name ?? '').trim() || (isHostClaim ? 'Host' : 'Player');
      targetRoom.players.set(myId, { kind: 'human', ws, id: myId, name, isHost: isHostClaim });
      sendTo(ws, { type: 'joined', playerId: myId, isHost: isHostClaim, roomCode: code });
      broadcastLobbyState(targetRoom);
    }

    // ── All other messages require being in a room ───────────────────────────
    else {
      const room = myCode ? rooms.get(myCode) : null;
      if (!room || !myId) return;

      // ── Add bot ───────────────────────────────────────────────────────────
      if (msg.type === 'add_bot') {
        const me = room.players.get(myId);
        if (!me || isBot(me) || !me.isHost) { sendTo(ws, { type: 'error', message: 'Only the host can add bots.' }); return; }
        if (room.players.size >= room.maxPlayers) { sendTo(ws, { type: 'error', message: 'Room is full.' }); return; }
        const botNum = Array.from(room.players.values()).filter(isBot).length + 1;
        const botId = generateId();
        room.players.set(botId, { kind: 'bot', id: botId, name: `Bot ${botNum}` });
        broadcastLobbyState(room);
      }

      // ── Remove bot ────────────────────────────────────────────────────────
      else if (msg.type === 'remove_bot') {
        const me = room.players.get(myId);
        if (!me || isBot(me) || !me.isHost) { sendTo(ws, { type: 'error', message: 'Only the host can remove bots.' }); return; }
        const target = room.players.get(String(msg.botId));
        if (target && isBot(target)) {
          room.players.delete(target.id);
          broadcastLobbyState(room);
        }
      }

      // ── Start game ────────────────────────────────────────────────────────
      else if (msg.type === 'start_game') {
        const me = room.players.get(myId);
        if (!me || isBot(me) || !me.isHost) { sendTo(ws, { type: 'error', message: 'Only the host can start.' }); return; }
        if (room.players.size < 2) { sendTo(ws, { type: 'error', message: 'Need at least 2 players.' }); return; }
        if (room.players.size < room.maxPlayers) { sendTo(ws, { type: 'error', message: 'Not all slots are filled yet.' }); return; }

        const allPlayers = Array.from(room.players.values());
        let gs = startGame({ playerNames: allPlayers.map(p => p.name), seed: Date.now(), initialCards: room.initialCards, numRounds: room.numRounds });
        gs = { ...gs, players: gs.players.map((p, i) => ({ ...p, id: allPlayers[i].id })) };

        room.gameState = gs;
        room.phase = 'playing';
        room.scoreHistory = [];

        broadcastHumans(room, { type: 'game_started' });
        setTimeout(() => broadcastGameState(room), 50);
      }

      // ── Predict ───────────────────────────────────────────────────────────
      else if (msg.type === 'predict') {
        if (!room.gameState) return;
        const gs = room.gameState;
        if (gs.players[gs.currentPlayer].id !== myId) {
          sendTo(ws, { type: 'error', message: "It's not your turn to predict." }); return;
        }
        const { state, error } = makePrediction(gs, Number(msg.value));
        if (error) { sendTo(ws, { type: 'error', message: error }); return; }
        room.gameState = state;
        if (state.phase === 'round_end') captureRoundScores(room, state);
        broadcastGameState(room);
      }

      // ── Start next round (host only) ──────────────────────────────────────
      else if (msg.type === 'start_next_round') {
        const me = room.players.get(myId);
        if (!me || isBot(me) || !me.isHost) { sendTo(ws, { type: 'error', message: 'Only the host can start the next round.' }); return; }
        if (!room.gameState || room.gameState.phase !== 'round_end') return;
        room.gameState = advanceToNextRound(room.gameState);
        broadcastGameState(room);
      }

      // ── Play card ─────────────────────────────────────────────────────────
      else if (msg.type === 'play_card') {
        if (!room.gameState) return;
        if (room.trickPreviewActive) {
          sendTo(ws, { type: 'error', message: 'Please wait for the trick to finish.' }); return;
        }
        const gs = room.gameState;
        if (gs.players[gs.currentPlayer].id !== myId) {
          sendTo(ws, { type: 'error', message: "It's not your turn." }); return;
        }
        const err = processCardPlay(room, gs, String(msg.cardId));
        if (err) sendTo(ws, { type: 'error', message: err });
      }

      // ── Chat ──────────────────────────────────────────────────────────────
      else if (msg.type === 'chat') {
        const me = room.players.get(myId);
        if (!me) return;
        const text = String(msg.text ?? '').trim().slice(0, 200);
        if (!text) return;
        broadcastHumans(room, { type: 'chat', playerId: myId, playerName: me.name, text });
      }
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  ws.on('close', () => {
    if (!myId || !myCode) return;
    const room = rooms.get(myCode);
    if (!room) return;

    const leaving = room.players.get(myId);
    if (!leaving) return;

    room.players.delete(myId);

    const humanCount = Array.from(room.players.values()).filter(isHuman).length;

    if (room.phase === 'lobby') {
      if (humanCount === 0) {
        if (room.botTurnTimer) clearTimeout(room.botTurnTimer);
        if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
        room.cleanupTimer = setTimeout(() => { rooms.delete(myCode!); }, 90_000);
        return;
      }
      if (isHuman(leaving) && leaving.isHost) {
        const newHost = Array.from(room.players.values()).find(isHuman) as HumanPlayer | undefined;
        if (newHost) newHost.isHost = true;
      }
      broadcastLobbyState(room);
      return;
    }

    // ── Game in progress ────────────────────────────────────────────────────
    if (!isHuman(leaving)) return; // bot disconnect — ignore

    if (humanCount === 0 && room.disconnectedGamePlayers.size === 0) {
      // Nobody left at all — clean up immediately
      if (room.botTurnTimer) clearTimeout(room.botTurnTimer);
      rooms.delete(myCode);
      return;
    }

    // Give the player 60 s to return; bot covers their turns in the meantime
    const capturedCode = myCode;
    const capturedId   = myId;
    const capturedName = leaving.name;
    const killTimer = setTimeout(() => {
      const r = rooms.get(capturedCode!);
      if (!r) return;
      r.disconnectedGamePlayers.delete(capturedId!);
      broadcastHumans(r, { type: 'player_disconnected', playerName: capturedName });
      if (r.botTurnTimer) clearTimeout(r.botTurnTimer);
      rooms.delete(capturedCode!);
    }, 60_000);
    room.disconnectedGamePlayers.set(myId!, { name: leaving.name, isHost: leaving.isHost, killTimer });
    broadcastGameState(room); // refresh online indicators for remaining players
    scheduleCheckBotTurn(room); // in case it's now this disconnected player's turn
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Judgement Card Game Server');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log('\n  Players join by room code — share the 4-character code after hosting.\n');
});
