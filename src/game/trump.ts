import { Suit } from './card';

export type TrumpSuit = Suit | 'none';

/**
 * The repeating trump order as defined in the rules (section 4):
 * Spades → Diamonds → Clubs → Hearts → No Trump → (repeat)
 */
const TRUMP_CYCLE: TrumpSuit[] = ['spades', 'diamonds', 'clubs', 'hearts', 'none'];

/**
 * Returns the trump suit for a given round number (1-indexed).
 * The cycle repeats indefinitely.
 */
export function getTrumpForRound(roundNumber: number): TrumpSuit {
  const index = (roundNumber - 1) % TRUMP_CYCLE.length;
  return TRUMP_CYCLE[index];
}

/**
 * Returns a human-readable label for a trump suit.
 */
export function trumpLabel(trump: TrumpSuit): string {
  if (trump === 'none') return 'No Trump';
  return trump.charAt(0).toUpperCase() + trump.slice(1);
}
