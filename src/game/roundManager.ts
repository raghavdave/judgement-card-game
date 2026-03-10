/**
 * Manages the card count sequence across rounds.
 *
 * Rule (section 2 & 3):
 * The starting number of cards depends on player count:
 *   4–7 players → 7 cards
 *   8 players   → 6 cards
 *   9 players   → 5 cards
 *   10 players  → 4 cards
 *
 * The sequence decreases from the starting value down to 1,
 * then increases back to the starting value.
 * Example (start=7): 7 6 5 4 3 2 1 2 3 4 5 6 7  (13 rounds total)
 */

/**
 * Returns the starting card count for the given number of players.
 */
export function getStartingCardCount(playerCount: number): number {
  if (playerCount >= 2 && playerCount <= 7) return 7;
  if (playerCount === 8) return 6;
  if (playerCount === 9) return 5;
  if (playerCount === 10) return 4;
  throw new Error(`Invalid player count: ${playerCount}. Must be between 2 and 10.`);
}

/**
 * Generates the full sequence of card counts for each round.
 * Example (start=7): [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]
 */
export function generateRoundSequence(startingCards: number): number[] {
  const decreasing: number[] = [];
  for (let i = startingCards; i >= 1; i--) {
    decreasing.push(i);
  }
  const increasing: number[] = [];
  for (let i = 2; i <= startingCards; i++) {
    increasing.push(i);
  }
  return [...decreasing, ...increasing];
}

/**
 * Returns the number of cards to deal in a specific round (1-indexed).
 */
export function getCardsForRound(roundNumber: number, startingCards: number): number {
  const sequence = generateRoundSequence(startingCards);
  if (roundNumber < 1 || roundNumber > sequence.length) {
    throw new Error(
      `Round ${roundNumber} is out of bounds. Total rounds: ${sequence.length}`
    );
  }
  return sequence[roundNumber - 1];
}

/**
 * Returns the total number of rounds in the game.
 */
export function getTotalRounds(startingCards: number): number {
  return generateRoundSequence(startingCards).length;
}
