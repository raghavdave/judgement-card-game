import {
  getStartingCardCount,
  generateRoundSequence,
  getCardsForRound,
  getTotalRounds,
} from '../src/game/roundManager';

describe('roundManager', () => {
  describe('getStartingCardCount', () => {
    test.each([
      [4, 7], [5, 7], [6, 7], [7, 7],
      [8, 6], [9, 5], [10, 4],
    ])('%i players → %i starting cards', (players, cards) => {
      expect(getStartingCardCount(players)).toBe(cards);
    });
  });

  describe('generateRoundSequence', () => {
    test('7 cards: full 13-round sequence', () => {
      expect(generateRoundSequence(7)).toEqual([7,6,5,4,3,2,1,2,3,4,5,6,7]);
    });

    test('4 cards: full 7-round sequence', () => {
      expect(generateRoundSequence(4)).toEqual([4,3,2,1,2,3,4]);
    });

    test('minimum value is always 1', () => {
      [4, 5, 6, 7].forEach(s => {
        const seq = generateRoundSequence(s);
        expect(Math.min(...seq)).toBe(1);
      });
    });

    test('starts and ends at starting value', () => {
      [4, 5, 6, 7].forEach(s => {
        const seq = generateRoundSequence(s);
        expect(seq[0]).toBe(s);
        expect(seq[seq.length - 1]).toBe(s);
      });
    });
  });

  describe('getCardsForRound', () => {
    test('round 1 = starting cards', () => {
      expect(getCardsForRound(1, 7)).toBe(7);
    });

    test('middle round (lowest) = 1', () => {
      // For start=7: round 7 = 1 card
      expect(getCardsForRound(7, 7)).toBe(1);
    });

    test('last round = starting cards', () => {
      expect(getCardsForRound(13, 7)).toBe(7);
    });

    test('throws for out-of-bounds round', () => {
      expect(() => getCardsForRound(0, 7)).toThrow();
      expect(() => getCardsForRound(14, 7)).toThrow();
    });
  });

  describe('getTotalRounds', () => {
    test.each([
      [4, 7], [5, 9], [6, 11], [7, 13],
    ])('starting cards %i → %i total rounds', (s, r) => {
      expect(getTotalRounds(s)).toBe(r);
    });
  });
});
