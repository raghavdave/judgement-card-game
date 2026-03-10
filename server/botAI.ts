/**
 * Bot AI for Judgement.
 *
 * Fair-play constraint: every function here receives ONLY:
 *   - The bot's own hand  (Card[])
 *   - A BotPublicState   (public info only — no other players' cards)
 *
 * This guarantees each bot is informationally isolated from other bots.
 */

import { Card, Suit, RANK_VALUES } from '../src/game/card';
import { TrumpSuit } from '../src/game/trump';
import { canPlayCard, determineTrickWinner, validatePrediction, TrickCard } from '../src/game/rules';

// ---------------------------------------------------------------------------
// Public-only game state view — deliberately excludes all players' hands
// ---------------------------------------------------------------------------

export interface BotPublicPlayer {
  id: string;
  predictedTricks: number | null;
  tricksWon: number;
  handSize: number;
}

export interface BotPublicState {
  players: BotPublicPlayer[];
  cardsPerPlayer: number;
  tricksPlayedThisRound: number;
  trumpSuit: TrumpSuit;
  leadSuit: Suit | null;
  trickCards: TrickCard[];
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

/**
 * Estimates how many tricks the bot expects to win, then validates against
 * the prediction restriction rule (last player cannot make sum = total).
 */
export function botPrediction(hand: Card[], state: BotPublicState, botPlayerId: string): number {
  const { cardsPerPlayer, trumpSuit, players } = state;

  // Estimate wins by card strength
  let estimate = 0;
  for (const card of hand) {
    const rv = RANK_VALUES[card.rank];
    if (trumpSuit !== 'none' && card.suit === trumpSuit) {
      if (rv >= 13) estimate += 0.85;       // king / ace of trump
      else if (rv >= 11) estimate += 0.60;  // jack / queen of trump
      else if (rv >= 9)  estimate += 0.40;
      else               estimate += 0.25;
    } else {
      if (rv === 14)     estimate += 0.55;  // ace of any suit
      else if (rv === 13) estimate += 0.30; // king
      else if (rv === 12) estimate += 0.15; // queen
      // lower cards rarely win outright
    }
  }

  let prediction = Math.round(estimate);
  prediction = Math.max(0, Math.min(cardsPerPlayer, prediction));

  // Apply prediction restriction for the last predictor
  const alreadyPredicted = players
    .filter(p => p.predictedTricks !== null)
    .map(p => p.predictedTricks as number);
  const isLast = alreadyPredicted.length === players.length - 1;

  if (!validatePrediction(prediction, cardsPerPlayer, alreadyPredicted, isLast).valid) {
    // Walk outward from estimate to find nearest valid value
    for (let d = 1; d <= cardsPerPlayer + 1; d++) {
      if (prediction + d <= cardsPerPlayer &&
          validatePrediction(prediction + d, cardsPerPlayer, alreadyPredicted, isLast).valid) {
        return prediction + d;
      }
      if (prediction - d >= 0 &&
          validatePrediction(prediction - d, cardsPerPlayer, alreadyPredicted, isLast).valid) {
        return prediction - d;
      }
    }
    return 0; // fallback (should be unreachable)
  }

  return prediction;
}

// ---------------------------------------------------------------------------
// Card selection
// ---------------------------------------------------------------------------

/**
 * Chooses the best card to play given the bot's hand and public game state.
 * Never inspects any other player's hand.
 */
export function botChooseCard(hand: Card[], state: BotPublicState, botPlayerId: string): string {
  const { trumpSuit, leadSuit, trickCards, players } = state;

  const legal = hand.filter(c => canPlayCard(c, hand, leadSuit, trumpSuit));
  if (legal.length === 0) return hand[0].id;
  if (legal.length === 1) return legal[0].id;

  const me = players.find(p => p.id === botPlayerId)!;
  const wantMore = me.tricksWon < (me.predictedTricks ?? 0);

  // Leading the trick
  if (!leadSuit) {
    return bestLead(legal, trumpSuit, wantMore).id;
  }

  // Determine current trick leader from public cards only
  const currentWinnerId = safeCurrentWinner(trickCards, leadSuit, trumpSuit);
  const amWinning = currentWinnerId === botPlayerId;

  const hasSuit = hand.some(c => c.suit === leadSuit);
  if (hasSuit) {
    return bestFollowSuit(legal, trickCards, leadSuit, wantMore, amWinning).id;
  }

  return bestOffSuit(legal, trickCards, trumpSuit, wantMore).id;
}

// ---------------------------------------------------------------------------
// Strategy helpers
// ---------------------------------------------------------------------------

function rv(c: Card): number { return RANK_VALUES[c.rank]; }

function safeCurrentWinner(
  trickCards: TrickCard[],
  leadSuit: Suit,
  trumpSuit: TrumpSuit
): string | null {
  if (trickCards.length === 0) return null;
  try { return determineTrickWinner(trickCards, leadSuit, trumpSuit); }
  catch { return null; }
}

/** Bot leads a trick. */
function bestLead(legal: Card[], trump: TrumpSuit, wantMore: boolean): Card {
  if (wantMore) {
    // Lead strong non-trump first; preserve trump for later cuts
    const nonTrump = legal.filter(c => c.suit !== trump);
    const pool = nonTrump.length > 0 ? nonTrump : legal;
    return pool.reduce((b, c) => rv(c) > rv(b) ? c : b);
  }
  // Trying to lose — discard weakest card
  return legal.reduce((b, c) => rv(c) < rv(b) ? c : b);
}

/** Bot must follow the lead suit. */
function bestFollowSuit(
  legal: Card[],
  trickCards: TrickCard[],
  leadSuit: Suit,
  wantMore: boolean,
  amWinning: boolean
): Card {
  if (wantMore && !amWinning) {
    // Try to take the lead: lowest card that beats current best
    const currentBest = trickCards
      .filter(tc => tc.card.suit === leadSuit)
      .reduce<Card | null>((b, tc) => b === null || rv(tc.card) > rv(b) ? tc.card : b, null);

    if (currentBest) {
      const beaters = legal.filter(c => rv(c) > rv(currentBest));
      if (beaters.length > 0) return beaters.reduce((b, c) => rv(c) < rv(b) ? c : b); // finesse
    }
    // Can't beat it — throw lowest
    return legal.reduce((b, c) => rv(c) < rv(b) ? c : b);
  }

  if (wantMore && amWinning) {
    // Already leading — play highest to protect the lead
    return legal.reduce((b, c) => rv(c) > rv(b) ? c : b);
  }

  // Don't want this trick — throw lowest
  return legal.reduce((b, c) => rv(c) < rv(b) ? c : b);
}

/** Bot is void in lead suit — can play any card. */
function bestOffSuit(
  legal: Card[],
  trickCards: TrickCard[],
  trump: TrumpSuit,
  wantMore: boolean
): Card {
  if (wantMore && trump !== 'none') {
    const myTrumps = legal.filter(c => c.suit === trump);
    if (myTrumps.length > 0) {
      const trickHasTrump = trickCards.some(tc => tc.card.suit === trump);

      if (!trickHasTrump) {
        // First trump in trick — lowest trump wins cheaply
        return myTrumps.reduce((b, c) => rv(c) < rv(b) ? c : b);
      }

      // Need to beat existing trump
      const bestExistingTrump = trickCards
        .filter(tc => tc.card.suit === trump)
        .reduce<Card | null>((b, tc) => b === null || rv(tc.card) > rv(b) ? tc.card : b, null);

      if (bestExistingTrump) {
        const beaters = myTrumps.filter(c => rv(c) > rv(bestExistingTrump));
        if (beaters.length > 0) return beaters.reduce((b, c) => rv(c) < rv(b) ? c : b);
        // Can't beat existing trump — fall through to discard
      }
    }
  }

  // Discard: lowest non-trump first; only trump if no other option
  const nonTrump = trump !== 'none' ? legal.filter(c => c.suit !== trump) : legal;
  const pool = nonTrump.length > 0 ? nonTrump : legal;
  return pool.reduce((b, c) => rv(c) < rv(b) ? c : b);
}
