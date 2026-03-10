import {
  determineTrickWinner,
  mustFollowSuit,
  canPlayCard,
  validatePrediction,
  TrickCard,
} from '../src/game/rules';
import { Card } from '../src/game/card';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function card(rank: string, suit: string): Card {
  return { id: `${rank}_of_${suit}`, suit: suit as any, rank: rank as any };
}

function tc(playerId: string, rank: string, suit: string): TrickCard {
  return { playerId, card: card(rank, suit) };
}

// ---------------------------------------------------------------------------
// mustFollowSuit
// ---------------------------------------------------------------------------

describe('mustFollowSuit', () => {
  test('returns true when player has the lead suit', () => {
    const hand = [card('ace', 'spades'), card('3', 'hearts')];
    expect(mustFollowSuit(hand, 'spades')).toBe(true);
  });

  test('returns false when player does not have the lead suit', () => {
    const hand = [card('ace', 'diamonds'), card('3', 'hearts')];
    expect(mustFollowSuit(hand, 'spades')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canPlayCard
// ---------------------------------------------------------------------------

describe('canPlayCard', () => {
  test('any card is valid when leading (no lead suit)', () => {
    const hand = [card('ace', 'spades'), card('3', 'hearts')];
    expect(canPlayCard(card('ace', 'spades'), hand, null, 'spades')).toBe(true);
    expect(canPlayCard(card('3', 'hearts'), hand, null, 'spades')).toBe(true);
  });

  test('must follow suit when player has lead suit', () => {
    const hand = [card('ace', 'spades'), card('3', 'hearts')];
    // Can play spades (correct suit)
    expect(canPlayCard(card('ace', 'spades'), hand, 'spades', 'diamonds')).toBe(true);
    // Cannot play hearts when holding spades
    expect(canPlayCard(card('3', 'hearts'), hand, 'spades', 'diamonds')).toBe(false);
  });

  test('any card valid when player does not have lead suit (trump cut or fuse)', () => {
    const hand = [card('king', 'diamonds'), card('5', 'clubs')];
    // Neither spades in hand — can play anything
    expect(canPlayCard(card('king', 'diamonds'), hand, 'spades', 'diamonds')).toBe(true);
    expect(canPlayCard(card('5', 'clubs'), hand, 'spades', 'diamonds')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// determineTrickWinner — with trump
// ---------------------------------------------------------------------------

describe('determineTrickWinner — trump present', () => {
  test('highest trump wins over any lead-suit card', () => {
    const trick: TrickCard[] = [
      tc('p1', 'ace', 'hearts'),   // lead suit ace — very high
      tc('p2', '2', 'spades'),     // trump 2 — low trump
      tc('p3', 'king', 'hearts'),  // lead suit king
    ];
    // trump = spades → p2 wins with 2 of spades
    expect(determineTrickWinner(trick, 'hearts', 'spades')).toBe('p2');
  });

  test('highest trump wins when multiple trump cards played', () => {
    const trick: TrickCard[] = [
      tc('p1', 'ace', 'hearts'),
      tc('p2', 'king', 'spades'),   // trump
      tc('p3', 'ace', 'spades'),    // trump — highest
    ];
    expect(determineTrickWinner(trick, 'hearts', 'spades')).toBe('p3');
  });

  test('highest lead-suit card wins when no trump played', () => {
    const trick: TrickCard[] = [
      tc('p1', '7', 'hearts'),
      tc('p2', 'jack', 'hearts'),   // highest hearts
      tc('p3', '3', 'clubs'),       // off-suit, no trump
    ];
    // trump = spades, none played
    expect(determineTrickWinner(trick, 'hearts', 'spades')).toBe('p2');
  });
});

// ---------------------------------------------------------------------------
// determineTrickWinner — No Trump round
// ---------------------------------------------------------------------------

describe('determineTrickWinner — No Trump round', () => {
  test('highest lead-suit card wins in No Trump round', () => {
    const trick: TrickCard[] = [
      tc('p1', '5', 'hearts'),
      tc('p2', 'ace', 'hearts'),    // highest hearts
      tc('p3', 'king', 'diamonds'), // off-suit
    ];
    expect(determineTrickWinner(trick, 'hearts', 'none')).toBe('p2');
  });

  test('trump suit cards are not treated as trump in No Trump round', () => {
    // Even if spades are played, in a 'none' trump round they are just off-suit
    const trick: TrickCard[] = [
      tc('p1', 'queen', 'clubs'),   // lead
      tc('p2', 'ace', 'spades'),    // would be trump in spades round — NOT here
      tc('p3', 'king', 'clubs'),    // highest clubs
    ];
    expect(determineTrickWinner(trick, 'clubs', 'none')).toBe('p3');
  });
});

// ---------------------------------------------------------------------------
// validatePrediction
// ---------------------------------------------------------------------------

describe('validatePrediction', () => {
  test('valid prediction in normal range for non-last player', () => {
    const result = validatePrediction(3, 7, [2, 1], false);
    expect(result.valid).toBe(true);
  });

  test('rejects prediction out of range (negative)', () => {
    const result = validatePrediction(-1, 7, [], false);
    expect(result.valid).toBe(false);
  });

  test('rejects prediction greater than cardsPerPlayer', () => {
    const result = validatePrediction(8, 7, [], false);
    expect(result.valid).toBe(false);
  });

  test('last player: forbidden value blocks equal-total scenario', () => {
    // cardsPerPlayer = 7; previous sum = 6; forbidden = 1
    const result = validatePrediction(1, 7, [0, 4, 2], true);
    expect(result.valid).toBe(false);
  });

  test('last player: other values are allowed', () => {
    // forbidden = 1 → 0 or 2 is ok
    expect(validatePrediction(0, 7, [0, 4, 2], true).valid).toBe(true);
    expect(validatePrediction(2, 7, [0, 4, 2], true).valid).toBe(true);
  });

  test('last player: 0 predictions existing — forbidden = cardsPerPlayer', () => {
    // sum=0, forbidden=7; prediction of 7 is blocked
    expect(validatePrediction(7, 7, [0, 0, 0], true).valid).toBe(false);
    // 6 is fine
    expect(validatePrediction(6, 7, [0, 0, 0], true).valid).toBe(true);
  });
});
