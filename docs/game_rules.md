# Game Rules — Judgement Card Game

## 1. Game Overview

Judgement is a trick-taking card game played with **4 to 10 players** using **one standard 52-card deck**.

The game consists of multiple rounds.
In each round:

1. Cards are dealt.
2. Players predict how many tricks (hands) they will win.
3. Players play tricks.
4. Scores are calculated based on prediction accuracy.

The objective is to **win exactly the number of tricks that you predicted**.

---

# 2. Setup

### Players

* Minimum: 2 players
* Maximum: 10 players

### Deck

* One standard **52-card deck**
* No jokers

### Initial Cards Per Player

The starting number of cards depends on the number of players.

Typical starting values:

| Players | Starting Cards |
| ------- | -------------- |
| 2–7     | 7 cards        |
| 8       | 6 cards        |
| 9       | 5 cards        |
| 10      | 4 cards        |

---

# 3. Round Structure

The number of cards dealt per player changes each round.

### Phase 1 — Decreasing Phase

The number of cards decreases by 1 each round until it reaches **1 card**.

Example (starting with 7):

7 → 6 → 5 → 4 → 3 → 2 → 1

### Phase 2 — Increasing Phase

After the 1-card round, the number increases again until it returns to the original starting number.

Example:

1 → 2 → 3 → 4 → 5 → 6 → 7

This completes the full game cycle.

---

# 4. Trump Order

Each round has a trump suit.

Trump follows this repeating order:

1. Spades
2. Diamonds
3. Clubs
4. Hearts
5. No Trump

After **No Trump**, the sequence restarts from **Spades**.

---

# 5. Trick Rules

Each round consists of several **tricks** (one trick per card held by players).

### Starting a Trick

The player whose turn it is **leads** the trick by playing any card.

### Following Suit

Other players must follow these rules:

1. If a player has the **same suit as the lead card**, they **must play that suit**.
2. If a player **does not have that suit**, they may:

   * play a **trump card** (cut), or
   * play any other card (fuse).

---

# 6. Trick Winner Determination

### When Trump Exists

1. If **one or more trump cards** are played:

   * The **highest trump card wins the trick**.

2. If **no trump cards** are played:

   * The **highest card of the lead suit wins the trick**.

### No Trump Round

During the **No Trump** round:

* Players **cannot cut** (cannot use trump).
* The **highest card of the lead suit** wins the trick.

---

# 7. Card Ranking

Within each suit the ranking is:

ace (highest)
king
queen
jack
10
9
8
7
6
5
4
3
2 (lowest)

---

# 8. Prediction Phase

After cards are dealt but **before tricks begin**, each player predicts how many tricks they will win.

Players announce predictions **in turn order**.

Predictions are integers between:

0 and the number of cards dealt that round.

---

# 9. Prediction Restriction Rule

The sum of all predictions **cannot equal the total number of tricks available** in that round.

Total tricks available = number of cards dealt per player.

Example:

4 players
7 cards each

Total tricks = 7

Predictions:

Player 1 → 0
Player 2 → 4
Player 3 → 2

Current total = 6

Player 4 **cannot predict 1** because:

6 + 1 = 7

That would equal the total tricks and allow everyone to succeed.

Player 4 must choose any value **except 1**.

---

# 10. Round Leader Rotation

The starting player rotates each round.

Example for 4 players:

Round 1 → Player 1 leads
Round 2 → Player 2 leads
Round 3 → Player 3 leads
Round 4 → Player 4 leads
Round 5 → Player 1 leads again

---

# 11. Objective

Players attempt to win **exactly the number of tricks they predicted**.

### Scoring

If a player wins exactly the predicted number of tricks:

Score = 11*(Number of tricks predicted) + 10

If a player wins **more or fewer tricks** than predicted:

Score = -11*(Number of tricks predicted) - 1

After every round, score for that given round is calculated and added to the score of the previous rounds.
At the end of all rounds, the player with the highest score wins.

---

# 12. Key Terminology

Trick
A set of cards played by all players in a single round of play.

Lead
The first card played in a trick.

Cut
Playing a trump card when unable to follow suit.

Fuse
Playing any non-trump card when unable to follow suit.
