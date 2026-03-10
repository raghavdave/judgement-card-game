import { Card } from './card';

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  /** Number of tricks the player predicted for the current round. null = not yet predicted. */
  predictedTricks: number | null;
  /** Number of tricks won so far in the current round. */
  tricksWon: number;
  /** Cumulative score across all completed rounds. */
  score: number;
}

/**
 * Creates a new player with empty state.
 */
export function createPlayer(id: string, name: string): Player {
  return {
    id,
    name,
    hand: [],
    predictedTricks: null,
    tricksWon: 0,
    score: 0,
  };
}

/**
 * Resets per-round fields on a player (hand, prediction, tricks won).
 */
export function resetPlayerForRound(player: Player): Player {
  return {
    ...player,
    hand: [],
    predictedTricks: null,
    tricksWon: 0,
  };
}

/**
 * Calculates the score for a single round based on prediction vs actual tricks won.
 * Rule: exact match → 11*predicted + 10; otherwise → -11*predicted - 1
 */
export function calculateRoundScore(predicted: number, tricksWon: number): number {
  if (predicted === tricksWon) {
    return 11 * predicted + 10;
  }
  return -11 * predicted - 1;
}
