import { Card, Suit, Rank, ALL_SUITS, ALL_RANKS, cardId } from './card';

/**
 * Creates a full 52-card standard deck (no jokers).
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      const id = cardId(rank, suit);
      deck.push({ id, suit, rank });
    }
  }
  return deck;
}

/**
 * Shuffles a deck using the Fisher-Yates algorithm with a provided RNG.
 * The RNG function must return a value in [0, 1) — same interface as Math.random().
 * Passing a seeded RNG makes shuffling deterministic and reproducible.
 */
export function shuffleDeck(deck: Card[], rng: () => number): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export interface DealResult {
  hands: Card[][];
  remainingDeck: Card[];
}

/**
 * Deals `cardsPerPlayer` cards to each player from the top of the deck.
 * Returns each player's hand and the remaining (undealt) deck.
 */
export function dealCards(deck: Card[], playerCount: number, cardsPerPlayer: number): DealResult {
  const totalNeeded = playerCount * cardsPerPlayer;
  if (totalNeeded > deck.length) {
    throw new Error(
      `Cannot deal ${cardsPerPlayer} cards to ${playerCount} players: deck only has ${deck.length} cards`
    );
  }

  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  let cardIndex = 0;

  // Deal one card at a time to each player in turn (round-robin)
  for (let round = 0; round < cardsPerPlayer; round++) {
    for (let p = 0; p < playerCount; p++) {
      hands[p].push(deck[cardIndex]);
      cardIndex++;
    }
  }

  return {
    hands,
    remainingDeck: deck.slice(cardIndex),
  };
}
