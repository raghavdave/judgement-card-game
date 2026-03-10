import { Card, Suit, RANK_VALUES } from './card';
import { TrumpSuit } from './trump';

export interface TrickCard {
  playerId: string;
  card: Card;
}

// ---------------------------------------------------------------------------
// Following suit
// ---------------------------------------------------------------------------

/**
 * Returns true if the player must follow the lead suit.
 * Rule (section 5): If a player has any card of the lead suit, they must play it.
 */
export function mustFollowSuit(hand: Card[], leadSuit: Suit): boolean {
  return hand.some((c) => c.suit === leadSuit);
}

/**
 * Determines whether a player can legally play a given card.
 *
 * Rules:
 * - If the player leads the trick (no lead suit yet), any card is valid.
 * - If the player has the lead suit, they must play it.
 * - If the player does not have the lead suit, any card is valid
 *   (trump cut or any other fuse).
 * - In a No Trump round, trump cards cannot be used to cut (but there is no
 *   trump suit anyway, so any card in hand is playable when unable to follow).
 */
export function canPlayCard(
  card: Card,
  hand: Card[],
  leadSuit: Suit | null,
  trumpSuit: TrumpSuit
): boolean {
  // Leading the trick — any card is valid
  if (leadSuit === null) return true;

  const hasSuit = hand.some((c) => c.suit === leadSuit);

  if (hasSuit) {
    // Must follow suit
    return card.suit === leadSuit;
  }

  // Does not have lead suit — in a No Trump round any card is valid
  // (there is no trump to restrict; the rule simply means no cutting exists)
  // In a normal round any card is valid (trump cut or fuse)
  return true;
}

// ---------------------------------------------------------------------------
// Trick winner
// ---------------------------------------------------------------------------

/**
 * Determines the winner of a trick.
 *
 * Rules (section 6):
 * - If trump cards are present (and it is not a No Trump round),
 *   the highest trump card wins.
 * - Otherwise, the highest card of the lead suit wins.
 *
 * Returns the playerId of the winner.
 */
export function determineTrickWinner(
  trickCards: TrickCard[],
  leadSuit: Suit,
  trumpSuit: TrumpSuit
): string {
  if (trickCards.length === 0) {
    throw new Error('Cannot determine winner of an empty trick');
  }

  const trumpCards =
    trumpSuit !== 'none'
      ? trickCards.filter((tc) => tc.card.suit === trumpSuit)
      : [];

  if (trumpCards.length > 0) {
    // Highest trump wins
    const winner = trumpCards.reduce((best, current) =>
      RANK_VALUES[current.card.rank] > RANK_VALUES[best.card.rank] ? current : best
    );
    return winner.playerId;
  }

  // No trump played — highest lead suit card wins
  const leadSuitCards = trickCards.filter((tc) => tc.card.suit === leadSuit);

  if (leadSuitCards.length === 0) {
    throw new Error('No cards of lead suit found in trick');
  }

  const winner = leadSuitCards.reduce((best, current) =>
    RANK_VALUES[current.card.rank] > RANK_VALUES[best.card.rank] ? current : best
  );
  return winner.playerId;
}

// ---------------------------------------------------------------------------
// Prediction validation
// ---------------------------------------------------------------------------

export interface PredictionValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a prediction for the last player in the prediction phase.
 *
 * Rule (section 9): The sum of all predictions cannot equal the total tricks
 * available (cardsPerPlayer). This restriction applies only to the last player
 * making a prediction.
 *
 * For non-final players, any value from 0 to cardsPerPlayer is valid.
 */
export function validatePrediction(
  prediction: number,
  cardsPerPlayer: number,
  existingPredictions: number[],
  isLastPlayer: boolean
): PredictionValidationResult {
  if (!Number.isInteger(prediction) || prediction < 0 || prediction > cardsPerPlayer) {
    return {
      valid: false,
      reason: `Prediction must be an integer between 0 and ${cardsPerPlayer}`,
    };
  }

  if (isLastPlayer) {
    const currentSum = existingPredictions.reduce((sum, p) => sum + p, 0);
    const forbiddenValue = cardsPerPlayer - currentSum;

    if (prediction === forbiddenValue) {
      return {
        valid: false,
        reason: `As the last player, you cannot predict ${prediction} because the total predictions would equal the number of tricks (${cardsPerPlayer})`,
      };
    }
  }

  return { valid: true };
}
