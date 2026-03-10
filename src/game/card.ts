// Card definitions for the Judgement card game

export type Suit = 'spades' | 'diamonds' | 'clubs' | 'hearts';

export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'jack' | 'queen' | 'king' | 'ace';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

// Rank values for comparison — higher number = stronger card
export const RANK_VALUES: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'jack': 11,
  'queen': 12,
  'king': 13,
  'ace': 14,
};

export const ALL_SUITS: Suit[] = ['spades', 'diamonds', 'clubs', 'hearts'];

export const ALL_RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10',
  'jack', 'queen', 'king', 'ace',
];

/**
 * Returns the card ID string, matching the asset naming format.
 * Example: ace_of_clubs, 4_of_diamonds, 10_of_spades
 */
export function cardId(rank: Rank, suit: Suit): string {
  return `${rank}_of_${suit}`;
}

/**
 * Returns the asset filename for a card.
 * Example: ace_of_clubs.svg
 */
export function cardImageFilename(card: Card): string {
  return `${card.id}.svg`;
}
