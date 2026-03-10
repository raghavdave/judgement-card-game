import { Card, Suit } from './card';
import { Player, createPlayer, resetPlayerForRound, calculateRoundScore } from './player';
import { createDeck, shuffleDeck, dealCards } from './deck';
import { TrumpSuit, getTrumpForRound } from './trump';
import { TrickCard, canPlayCard, determineTrickWinner, validatePrediction } from './rules';
import {
  getStartingCardCount,
  getCardsForRound,
  getTotalRounds,
} from './roundManager';

// ---------------------------------------------------------------------------
// Game state — fully serializable
// ---------------------------------------------------------------------------

export type GamePhase =
  | 'setup'
  | 'prediction'
  | 'playing'
  | 'round_end'
  | 'game_over';

export interface GameState {
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  trumpSuit: TrumpSuit;
  currentPlayer: number;        // index into players array
  trickCards: TrickCard[];      // cards played in the current trick
  roundNumber: number;          // 1-indexed
  cardsPerPlayer: number;       // cards dealt this round
  startingCards: number;        // starting card count for the game
  totalRounds: number;
  tricksPlayedThisRound: number;
  leadSuit: Suit | null;        // suit of the first card in the current trick
  phase: GamePhase;
  roundLeaderIndex: number;     // player index who leads round 1, rotates each round
  trickLeaderIndex: number;     // player index who leads the current trick
  lastTrickWinnerId: string | null;
  rngSeed: number;              // stored for replay / save-load
}

// ---------------------------------------------------------------------------
// Simple seeded RNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// startGame
// ---------------------------------------------------------------------------

export interface StartGameOptions {
  playerNames: string[];
  /** Optional seed for deterministic shuffling. Defaults to Date.now(). */
  seed?: number;
}

export function startGame(options: StartGameOptions): GameState {
  const { playerNames, seed = Date.now() } = options;
  const playerCount = playerNames.length;

  if (playerCount < 2 || playerCount > 10) {
    throw new Error(`Player count must be between 2 and 10. Got: ${playerCount}`);
  }

  const players: Player[] = playerNames.map((name, i) =>
    createPlayer(`player_${i + 1}`, name)
  );

  const startingCards = getStartingCardCount(playerCount);
  const totalRounds = getTotalRounds(startingCards);

  const state: GameState = {
    players,
    deck: [],
    discardPile: [],
    trumpSuit: 'spades',
    currentPlayer: 0,
    trickCards: [],
    roundNumber: 1,
    cardsPerPlayer: startingCards,
    startingCards,
    totalRounds,
    tricksPlayedThisRound: 0,
    leadSuit: null,
    phase: 'setup',
    roundLeaderIndex: 0,
    trickLeaderIndex: 0,
    lastTrickWinnerId: null,
    rngSeed: seed,
  };

  return startRound(state);
}

// ---------------------------------------------------------------------------
// startRound
// ---------------------------------------------------------------------------

export function startRound(state: GameState): GameState {
  const cardsPerPlayer = getCardsForRound(state.roundNumber, state.startingCards);
  const trumpSuit = getTrumpForRound(state.roundNumber);
  const rng = mulberry32(state.rngSeed + state.roundNumber);

  const freshDeck = createDeck();
  const shuffled = shuffleDeck(freshDeck, rng);
  const { hands } = dealCards(shuffled, state.players.length, cardsPerPlayer);

  const players = state.players.map((p, i) => ({
    ...resetPlayerForRound(p),
    hand: hands[i],
  }));

  // Round leader rotates each round (rule section 10)
  const roundLeaderIndex = (state.roundNumber - 1) % state.players.length;

  return {
    ...state,
    players,
    deck: [],
    discardPile: [],
    trumpSuit,
    cardsPerPlayer,
    trickCards: [],
    tricksPlayedThisRound: 0,
    leadSuit: null,
    phase: 'prediction',
    roundLeaderIndex,
    trickLeaderIndex: roundLeaderIndex,
    currentPlayer: roundLeaderIndex,
    lastTrickWinnerId: null,
  };
}

// ---------------------------------------------------------------------------
// makePrediction
// ---------------------------------------------------------------------------

export interface PredictionResult {
  state: GameState;
  error?: string;
}

export function makePrediction(state: GameState, prediction: number): PredictionResult {
  if (state.phase !== 'prediction') {
    return { state, error: 'Not in prediction phase' };
  }

  const playerIndex = state.currentPlayer;
  const player = state.players[playerIndex];

  // Determine if this is the last player to predict
  const predictedSoFar = state.players.filter((p) => p.predictedTricks !== null);
  const isLastPlayer = predictedSoFar.length === state.players.length - 1;
  const existingPredictions = predictedSoFar.map((p) => p.predictedTricks as number);

  const validation = validatePrediction(
    prediction,
    state.cardsPerPlayer,
    existingPredictions,
    isLastPlayer
  );

  if (!validation.valid) {
    return { state, error: validation.reason };
  }

  const updatedPlayer: Player = { ...player, predictedTricks: prediction };
  const players = state.players.map((p, i) => (i === playerIndex ? updatedPlayer : p));

  // Advance to next player (in circular order from roundLeaderIndex)
  const allPredicted = players.every((p) => p.predictedTricks !== null);
  const nextPlayerIndex = allPredicted
    ? state.trickLeaderIndex
    : nextPlayerFrom(playerIndex, state.players.length);

  return {
    state: {
      ...state,
      players,
      currentPlayer: nextPlayerIndex,
      phase: allPredicted ? 'playing' : 'prediction',
    },
  };
}

// ---------------------------------------------------------------------------
// playCard
// ---------------------------------------------------------------------------

export interface PlayCardResult {
  state: GameState;
  error?: string;
}

export function playCard(state: GameState, cardId: string): PlayCardResult {
  if (state.phase !== 'playing') {
    return { state, error: 'Not in playing phase' };
  }

  const playerIndex = state.currentPlayer;
  const player = state.players[playerIndex];
  const cardIndex = player.hand.findIndex((c) => c.id === cardId);

  if (cardIndex === -1) {
    return { state, error: `Card ${cardId} not in player's hand` };
  }

  const card = player.hand[cardIndex];

  // Validate the play
  if (!canPlayCard(card, player.hand, state.leadSuit, state.trumpSuit)) {
    return { state, error: `Cannot play ${card.id}: must follow suit (${state.leadSuit})` };
  }

  // Remove card from hand
  const newHand = player.hand.filter((_, i) => i !== cardIndex);
  const updatedPlayer: Player = { ...player, hand: newHand };

  const trickCard: TrickCard = { playerId: player.id, card };
  const trickCards = [...state.trickCards, trickCard];

  // Set lead suit when first card is played
  const leadSuit = state.leadSuit ?? card.suit;

  const players = state.players.map((p, i) => (i === playerIndex ? updatedPlayer : p));

  const allPlayed = trickCards.length === state.players.length;

  if (allPlayed) {
    return {
      state: resolveTrick({
        ...state,
        players,
        trickCards,
        leadSuit,
      }),
    };
  }

  return {
    state: {
      ...state,
      players,
      trickCards,
      leadSuit,
      currentPlayer: nextPlayerFrom(playerIndex, state.players.length),
    },
  };
}

// ---------------------------------------------------------------------------
// resolveTrick (internal — called automatically after last card in trick)
// ---------------------------------------------------------------------------

function resolveTrick(state: GameState): GameState {
  const leadSuit = state.leadSuit as Suit;
  const winnerId = determineTrickWinner(state.trickCards, leadSuit, state.trumpSuit);
  const winnerIndex = state.players.findIndex((p) => p.id === winnerId);

  const players = state.players.map((p) =>
    p.id === winnerId ? { ...p, tricksWon: p.tricksWon + 1 } : p
  );

  const discardPile = [...state.discardPile, ...state.trickCards.map((tc) => tc.card)];
  const tricksPlayedThisRound = state.tricksPlayedThisRound + 1;
  const roundOver = tricksPlayedThisRound === state.cardsPerPlayer;

  if (roundOver) {
    return endRound({
      ...state,
      players,
      discardPile,
      trickCards: [],
      leadSuit: null,
      tricksPlayedThisRound,
      trickLeaderIndex: winnerIndex,
      lastTrickWinnerId: winnerId,
    });
  }

  return {
    ...state,
    players,
    discardPile,
    trickCards: [],
    leadSuit: null,
    tricksPlayedThisRound,
    trickLeaderIndex: winnerIndex,
    currentPlayer: winnerIndex,
    lastTrickWinnerId: winnerId,
    phase: 'playing',
  };
}

// ---------------------------------------------------------------------------
// endRound
// ---------------------------------------------------------------------------

export function endRound(state: GameState): GameState {
  // Calculate scores
  const players = state.players.map((p) => {
    const predicted = p.predictedTricks ?? 0;
    const roundScore = calculateRoundScore(predicted, p.tricksWon);
    return { ...p, score: p.score + roundScore };
  });

  const isLastRound = state.roundNumber >= state.totalRounds;

  return {
    ...state,
    players,
    phase: isLastRound ? 'game_over' : 'round_end',
    roundNumber: isLastRound ? state.roundNumber : state.roundNumber + 1,
  };
}

/**
 * Advances to the next round. Call this from 'round_end' phase.
 */
export function advanceToNextRound(state: GameState): GameState {
  if (state.phase !== 'round_end') {
    throw new Error('Cannot advance: not in round_end phase');
  }
  return startRound(state);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nextPlayerFrom(currentIndex: number, playerCount: number): number {
  return (currentIndex + 1) % playerCount;
}

/**
 * Returns the winner(s) at game over (highest score).
 */
export function getWinners(state: GameState): Player[] {
  const maxScore = Math.max(...state.players.map((p) => p.score));
  return state.players.filter((p) => p.score === maxScore);
}
