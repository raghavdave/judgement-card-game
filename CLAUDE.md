# CLAUDE.md

## Purpose

This repository contains a digital implementation of a custom card game.

Claude Code assists with development, but must follow the documented rules exactly.

The gameplay rules are the **single source of truth** and are defined in:

docs/game_rules.md

Claude must **never invent or modify rules** that are not documented.

---

# Project Architecture

The project is separated into three layers:

1. Game Engine (pure logic)
2. Interface / UI
3. Tests

Game logic must remain completely independent of UI.

Directory structure:

src/
    game/
        card.ts
        deck.ts
        player.ts
        engine.ts
        rules.ts

tests/

docs/

---

# Core Development Principles

Claude must follow these principles when writing code.

### 1. Deterministic Game Logic

Game results must be deterministic and reproducible.

Avoid:

* hidden randomness
* time-based logic
* global mutable state

Randomness must come from a controlled RNG utility.

---

### 2. Pure Game Logic

The game engine must:

* contain **no UI code**
* contain **no network code**
* be testable independently

All gameplay decisions should be inside:

src/game/

---

### 3. Clear Separation of Responsibilities

Modules should follow these roles.

card.ts
Defines card types and properties.

deck.ts
Creates and manages decks.

player.ts
Tracks player state.

rules.ts
Contains rule validation and gameplay effects.

engine.ts
Manages turn order and game state.

---

# Development Workflow

When implementing a new feature Claude must:

1. Read docs/game_rules.md
2. Confirm the rule exists in documentation
3. Implement the logic in src/game/
4. Write unit tests
5. Ensure tests pass

If a rule is unclear, Claude should request clarification rather than guessing.

---

# Testing Requirements

Every rule implementation must have tests.

Tests should cover:

* valid moves
* invalid moves
* edge cases
* win conditions

Tests should live in:

tests/

Example test areas:

tests/rules.test.ts
tests/engine.test.ts

---

# State Model

Game state should be serializable so the game can support:

* save/load
* multiplayer
* replay systems

Avoid non-serializable objects.

Preferred format:

GameState object

Example:

{
players: [],
deck: [],
discardPile: [],
currentPlayer: 0,
turnNumber: 1
}

---

# Coding Standards

Claude should follow these guidelines.

Language: TypeScript

Prefer:

* small functions
* explicit types
* pure functions
* immutable state updates

Avoid:

* deeply nested logic
* large monolithic classes
* implicit behavior

---

# When Adding New Cards

If new cards are added:

1. Define the card in card.ts
2. Implement its behavior in rules.ts
3. Add unit tests
4. Update docs/game_rules.md if necessary

---

# Documentation

Gameplay rules live in:

docs/game_rules.md

Gameplay examples may live in:

docs/gameplay_examples.md

Claude should consult examples when implementing complex interactions.

---

# Important Constraint

The gameplay rules document is the **source of truth**.

Claude must never invent:

* new card abilities
* rule changes
* hidden mechanics

If information is missing, Claude should ask for clarification.

---

# Card images:

Card images are stored in:
assets/cards/

Naming format:
<rank>_of_<suit>.svg

Examples:
ace_of_clubs.svg
4_of_diamonds.svg
10_of_spades.svg

# Goal of the Project

Produce a clean, modular card game engine that can support:

* AI opponents
* multiplayer
* multiple game modes
* new cards
* rule expansions
