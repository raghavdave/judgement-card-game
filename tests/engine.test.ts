import { startGame, makePrediction, playCard, GameState } from '../src/game/engine';
import { getTrumpForRound } from '../src/game/trump';
import { getCardsForRound, generateRoundSequence, getStartingCardCount } from '../src/game/roundManager';
import { calculateRoundScore } from '../src/game/player';

// ---------------------------------------------------------------------------
// Round sequence
// ---------------------------------------------------------------------------

describe('generateRoundSequence', () => {
  test('produces correct sequence for 7 starting cards', () => {
    const seq = generateRoundSequence(7);
    expect(seq).toEqual([7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]);
  });

  test('produces correct sequence for 4 starting cards', () => {
    const seq = generateRoundSequence(4);
    expect(seq).toEqual([4, 3, 2, 1, 2, 3, 4]);
  });

  test('total rounds = 2*start - 1', () => {
    [4, 5, 6, 7].forEach(s => {
      expect(generateRoundSequence(s).length).toBe(2 * s - 1);
    });
  });
});

describe('getStartingCardCount', () => {
  test.each([
    [4, 7], [5, 7], [6, 7], [7, 7],
    [8, 6], [9, 5], [10, 4],
  ])('%i players → %i starting cards', (players, expected) => {
    expect(getStartingCardCount(players)).toBe(expected);
  });

  test('throws for invalid player count', () => {
    expect(() => getStartingCardCount(3)).toThrow();
    expect(() => getStartingCardCount(11)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Trump cycle
// ---------------------------------------------------------------------------

describe('getTrumpForRound', () => {
  test('follows Spades→Diamonds→Clubs→Hearts→None cycle', () => {
    expect(getTrumpForRound(1)).toBe('spades');
    expect(getTrumpForRound(2)).toBe('diamonds');
    expect(getTrumpForRound(3)).toBe('clubs');
    expect(getTrumpForRound(4)).toBe('hearts');
    expect(getTrumpForRound(5)).toBe('none');
    expect(getTrumpForRound(6)).toBe('spades'); // restarts
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('calculateRoundScore', () => {
  test('exact prediction: 11*predicted + 10', () => {
    expect(calculateRoundScore(0, 0)).toBe(10);
    expect(calculateRoundScore(3, 3)).toBe(43);
    expect(calculateRoundScore(7, 7)).toBe(87);
  });

  test('wrong prediction: -11*predicted - 1', () => {
    expect(calculateRoundScore(2, 0)).toBe(-23);
    expect(calculateRoundScore(0, 1)).toBe(-1);
    expect(calculateRoundScore(3, 5)).toBe(-34);
  });
});

// ---------------------------------------------------------------------------
// startGame
// ---------------------------------------------------------------------------

describe('startGame', () => {
  test('creates correct number of players', () => {
    const state = startGame({ playerNames: ['A', 'B', 'C', 'D'], seed: 1 });
    expect(state.players.length).toBe(4);
  });

  test('deals correct cards for round 1 with 4 players', () => {
    const state = startGame({ playerNames: ['A', 'B', 'C', 'D'], seed: 1 });
    expect(state.cardsPerPlayer).toBe(7);
    state.players.forEach(p => expect(p.hand.length).toBe(7));
  });

  test('starts in prediction phase', () => {
    const state = startGame({ playerNames: ['A', 'B', 'C', 'D'], seed: 1 });
    expect(state.phase).toBe('prediction');
  });

  test('first trump is spades', () => {
    const state = startGame({ playerNames: ['A', 'B', 'C', 'D'], seed: 1 });
    expect(state.trumpSuit).toBe('spades');
  });

  test('throws for too few players', () => {
    expect(() => startGame({ playerNames: ['A', 'B', 'C'] })).toThrow();
  });

  test('throws for too many players', () => {
    const names = Array.from({ length: 11 }, (_, i) => `P${i}`);
    expect(() => startGame({ playerNames: names })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// makePrediction
// ---------------------------------------------------------------------------

describe('makePrediction', () => {
  function freshState(): GameState {
    return startGame({ playerNames: ['A', 'B', 'C', 'D'], seed: 42 });
  }

  test('accepts a valid prediction', () => {
    const s0 = freshState();
    const { state, error } = makePrediction(s0, 2);
    expect(error).toBeUndefined();
    expect(state.players[0].predictedTricks).toBe(2);
  });

  test('advances to next player after prediction', () => {
    const s0 = freshState();
    const { state } = makePrediction(s0, 1);
    expect(state.currentPlayer).toBe(1);
  });

  test('rejects out-of-range prediction', () => {
    const s0 = freshState();
    const { error } = makePrediction(s0, 99);
    expect(error).toBeDefined();
  });

  test('last player cannot make total equal cardsPerPlayer', () => {
    let state = freshState();
    // 4 players, 7 cards. Get three predictions that sum to 6.
    ({ state } = makePrediction(state, 3));
    ({ state } = makePrediction(state, 2));
    ({ state } = makePrediction(state, 1));
    // sum = 6, forbidden = 1
    const { error } = makePrediction(state, 1);
    expect(error).toBeDefined();
  });

  test('transitions to playing phase once all players have predicted', () => {
    let state = freshState();
    // cardsPerPlayer = 7; sum = 3+2+1+2 = 8 ≠ 7, so all valid
    ({ state } = makePrediction(state, 3));
    ({ state } = makePrediction(state, 2));
    ({ state } = makePrediction(state, 1));
    ({ state } = makePrediction(state, 0));
    expect(state.phase).toBe('playing');
  });
});

// ---------------------------------------------------------------------------
// playCard — follow suit enforcement
// ---------------------------------------------------------------------------

describe('playCard — follow suit', () => {
  test('blocks playing off-suit when player has lead suit', () => {
    let state = startGame({ playerNames: ['A', 'B', 'C', 'D'], seed: 100 });

    // Complete prediction phase
    ({ state } = makePrediction(state, 2));
    ({ state } = makePrediction(state, 1));
    ({ state } = makePrediction(state, 1));
    ({ state } = makePrediction(state, 0));

    // Player 0 leads — play any card to establish lead suit
    const leadPlayer = state.players[state.currentPlayer];
    const leadCard = leadPlayer.hand[0];
    const { state: afterLead } = playCard(state, leadCard.id);

    // Player 1 must follow suit if they have it
    const nextPlayer = afterLead.players[afterLead.currentPlayer];
    const hasSuit = nextPlayer.hand.some(c => c.suit === afterLead.leadSuit);

    if (hasSuit) {
      // Find a card of a different suit to attempt to play
      const wrongCard = nextPlayer.hand.find(c => c.suit !== afterLead.leadSuit);
      if (wrongCard) {
        const { error } = playCard(afterLead, wrongCard.id);
        expect(error).toBeDefined();
      }
    }
    // If player doesn't have lead suit, any card is valid — skip check
  });
});

// ---------------------------------------------------------------------------
// Full round simulation (deterministic)
// ---------------------------------------------------------------------------

describe('full round simulation', () => {
  test('completes a round without errors', () => {
    let state = startGame({ playerNames: ['A', 'B', 'C', 'D'], seed: 999 });

    // Prediction phase
    const n = state.players.length;
    for (let i = 0; i < n - 1; i++) {
      ({ state } = makePrediction(state, 1));
    }
    // Last player picks a non-forbidden value
    const existing = state.players.filter(p => p.predictedTricks !== null).map(p => p.predictedTricks as number);
    const sum = existing.reduce((a, b) => a + b, 0);
    const forbidden = state.cardsPerPlayer - sum;
    const lastPred = forbidden === 0 ? 1 : 0;
    ({ state } = makePrediction(state, lastPred));

    expect(state.phase).toBe('playing');

    // Play through all tricks
    while (state.phase === 'playing') {
      const cp = state.currentPlayer;
      const player = state.players[cp];
      // Pick first playable card
      const playable = player.hand.find(c =>
        require('../src/game/rules').canPlayCard(c, player.hand, state.leadSuit, state.trumpSuit)
      );
      if (!playable) break;
      const result = playCard(state, playable.id);
      expect(result.error).toBeUndefined();
      state = result.state;
    }

    expect(['round_end', 'game_over']).toContain(state.phase);

    // Total tricks won should equal cardsPerPlayer
    const totalWon = state.players.reduce((sum, p) => sum + p.tricksWon, 0);
    expect(totalWon).toBe(state.cardsPerPlayer);
  });
});
