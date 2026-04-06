/**
 * scenario-builder.ts — fluent-API helper for constructing realistic mid-game
 * Pokemon TCG states for Plan 01-05's L4 deep state and L5 semantic tests.
 *
 * Built on top of `card-test-harness.ts` (which already provides direct State
 * mutation, the prompt resolver, and CardManager bootstrap). Adds:
 *   - A fluent API: ScenarioBuilder.mirror().turn(5).p0Active(...).build()
 *   - Per-Pokemon damage/energies/tools/conditions
 *   - Predictable top-of-deck for deterministic search test outcomes
 *   - Stadium pre-placement
 *   - Discard pile pre-population
 *   - Prizes-remaining knob
 *
 * Design rule: this is a TEST-ONLY helper. It bypasses the engine's normal
 * gameplay rules to set up specific scenarios. Production code (env.ts, bots,
 * self-play) must NEVER import from this module.
 *
 * Why a separate helper instead of extending card-test-harness?
 *   The harness uses an OPTIONS-OBJECT API (`buildCardTestContext({...})`)
 *   which is fine for L2/L3 single-card tests but is awkward for L4/L5 tests
 *   that need to specify many fields per Pokemon. The fluent API is much
 *   easier to read for "build a turn 6 mirror with damage on the bench and a
 *   tool attached to the active". The underlying state mutation is the same.
 *
 * Paper citation: Hearthstone §VII.A treats scripted scenarios as the engine
 * correctness gate — paper §VII.B notes that "scripted scenarios covering
 * corner cases were critical to preventing engine bugs from corrupting
 * training data". This builder is the implementation of that pattern.
 */

import { State, GamePhase } from '../../../game/store/state/state';
import { Player } from '../../../game/store/state/player';
import { CardList } from '../../../game/store/state/card-list';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { Store } from '../../../game/store/store';
import { Card } from '../../../game/store/card/card';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { CardManager } from '../../../game/cards/card-manager';
import { SpecialCondition } from '../../../game/store/card/card-types';
import { SeededRNG } from '../../seeded-rng';
import { SeededArbiter } from '../../seeded-arbiter';
import {
  CardTestContext,
  ensureCardManagerInitialized,
} from './card-test-harness';

// ---------------------------------------------------------------------------
// Per-Pokemon scenario shape
// ---------------------------------------------------------------------------

export interface PokemonScenario {
  pokemon: string;          // fullName, e.g. 'Dragapult ex TWM'
  damage?: number;          // pre-applied damage in HP units (NOT counters)
  energies?: string[];      // energy fullNames to attach in order
  tool?: string;            // tool fullName (single tool per Pokemon, like the engine)
  conditions?: SpecialCondition[];  // ASLEEP, BURNED, CONFUSED, PARALYZED, POISONED
}

export interface PlayerScenario {
  active: PokemonScenario | null;
  bench: PokemonScenario[];          // up to 5 (or 8 if Area Zero is active)
  hand: string[];                    // exact hand contents (overrides any default draw)
  discard: string[];                 // discard pile contents
  deckTop: string[];                 // pushed to the front of the deck for predictable search
  deckRest: string[];                // remainder of the deck (filler / extra)
  prizesRemaining: number;           // 0..6 (6 = full prize pile, 0 = won)
}

export interface ScenarioConfig {
  seed: number;
  turn: number;
  activePlayer: 0 | 1;
  players: [PlayerScenario, PlayerScenario];
  stadium: string | null;
}

// ---------------------------------------------------------------------------
// ScenarioBuilder — fluent API
// ---------------------------------------------------------------------------

export class ScenarioBuilder {

  private config: ScenarioConfig;

  constructor() {
    this.config = {
      seed: 42,
      turn: 1,
      activePlayer: 0,
      players: [
        {
          active: null,
          bench: [],
          hand: [],
          discard: [],
          deckTop: [],
          deckRest: [],
          prizesRemaining: 6,
        },
        {
          active: null,
          bench: [],
          hand: [],
          discard: [],
          deckTop: [],
          deckRest: [],
          prizesRemaining: 6,
        },
      ],
      stadium: null,
    };
  }

  /**
   * Preset: a realistic Dragapult mirror at turn 5 with both players having
   * a Dragapult ex active fully energized, partial bench, some hand cards,
   * and 4 prizes remaining each. A useful starting point that callers
   * customize via further fluent calls.
   */
  static mirror(): ScenarioBuilder {
    return new ScenarioBuilder()
      .turn(5)
      .p0Active('Dragapult ex TWM', { energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'] })
      .p0Bench('Drakloak TWM', { energies: ['Psychic Energy EVO'] })
      .p0Bench('Munkidori TWM')
      .p0Hand('Ultra Ball PLB', 'Boss\'s Orders MEG', 'Rare Candy SUM')
      .p0Prizes(4)
      .p1Active('Dragapult ex TWM', { energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'] })
      .p1Bench('Dreepy TWM')
      .p1Bench('Drakloak TWM')
      .p1Hand('Buddy-Buddy Poffin TEF')
      .p1Prizes(4);
  }

  // ---------- top-level config ----------

  seed(n: number): this {
    this.config.seed = n;
    return this;
  }

  turn(n: number): this {
    if (n < 1) throw new Error(`ScenarioBuilder.turn: turn must be >= 1, got ${n}`);
    this.config.turn = n;
    return this;
  }

  activePlayer(p: 0 | 1): this {
    this.config.activePlayer = p;
    return this;
  }

  stadium(name: string | null): this {
    this.config.stadium = name;
    return this;
  }

  // ---------- player 0 setters ----------

  p0Active(pokemon: string, opts: Partial<Omit<PokemonScenario, 'pokemon'>> = {}): this {
    this.config.players[0].active = { pokemon, ...opts };
    return this;
  }

  p0Bench(pokemon: string, opts: Partial<Omit<PokemonScenario, 'pokemon'>> = {}): this {
    if (this.config.players[0].bench.length >= 8) {
      throw new Error(`ScenarioBuilder.p0Bench: bench full (8 max)`);
    }
    this.config.players[0].bench.push({ pokemon, ...opts });
    return this;
  }

  p0Hand(...cards: string[]): this {
    this.config.players[0].hand.push(...cards);
    return this;
  }

  p0Discard(...cards: string[]): this {
    this.config.players[0].discard.push(...cards);
    return this;
  }

  p0DeckTop(...cards: string[]): this {
    this.config.players[0].deckTop.push(...cards);
    return this;
  }

  p0DeckRest(...cards: string[]): this {
    this.config.players[0].deckRest.push(...cards);
    return this;
  }

  p0Prizes(n: number): this {
    if (n < 0 || n > 6) throw new Error(`ScenarioBuilder.p0Prizes: must be 0..6, got ${n}`);
    this.config.players[0].prizesRemaining = n;
    return this;
  }

  // ---------- player 1 setters ----------

  p1Active(pokemon: string, opts: Partial<Omit<PokemonScenario, 'pokemon'>> = {}): this {
    this.config.players[1].active = { pokemon, ...opts };
    return this;
  }

  p1Bench(pokemon: string, opts: Partial<Omit<PokemonScenario, 'pokemon'>> = {}): this {
    if (this.config.players[1].bench.length >= 8) {
      throw new Error(`ScenarioBuilder.p1Bench: bench full (8 max)`);
    }
    this.config.players[1].bench.push({ pokemon, ...opts });
    return this;
  }

  p1Hand(...cards: string[]): this {
    this.config.players[1].hand.push(...cards);
    return this;
  }

  p1Discard(...cards: string[]): this {
    this.config.players[1].discard.push(...cards);
    return this;
  }

  p1DeckTop(...cards: string[]): this {
    this.config.players[1].deckTop.push(...cards);
    return this;
  }

  p1DeckRest(...cards: string[]): this {
    this.config.players[1].deckRest.push(...cards);
    return this;
  }

  p1Prizes(n: number): this {
    if (n < 0 || n > 6) throw new Error(`ScenarioBuilder.p1Prizes: must be 0..6, got ${n}`);
    this.config.players[1].prizesRemaining = n;
    return this;
  }

  /**
   * Construct the CardTestContext from the current config. Heavy lifting
   * happens here — direct state mutation to inject the configured zones.
   *
   * The returned context has the same shape as `buildCardTestContext` so
   * downstream test helpers (`dispatchAction`, `playCard`, etc.) work
   * unchanged.
   *
   * Engine invariant note: each Pokemon goes in with `pokemonPlayedTurn = 0`
   * so it can evolve immediately on `state.turn`. Damage is set directly on
   * the PokemonCardList. Energies/tools are pushed onto the cards array
   * matching the engine's storage convention.
   */
  build(): CardTestContext {
    ensureCardManagerInitialized();

    const rng = new SeededRNG(this.config.seed);
    const arbiter = new SeededArbiter(rng);

    const handler = { onStateChange: () => { /* noop */ } };
    const store = new Store(handler);
    const state = store.state;
    state.cardNames = [];

    const player = buildEmptyPlayer(1, 'P1');
    const opponent = buildEmptyPlayer(2, 'P2');
    state.players = [player, opponent];
    state.activePlayer = this.config.activePlayer;
    state.phase = GamePhase.PLAYER_TURN;
    state.turn = this.config.turn;

    // Place active Pokemon, bench, hand, discard, deck for both players.
    this.placePlayer(state, player, 0);
    this.placePlayer(state, opponent, 1);

    // Stadium
    if (this.config.stadium) {
      const stadium = makeCard(this.config.stadium);
      registerCard(state, stadium);
      // Stadium goes on player 0 by convention; the engine will swap it into
      // the active stadium slot when accessed via StateUtils.getStadiumCard.
      player.stadium.cards.push(stadium);
    }

    return {
      store,
      state: store.state,
      rng,
      arbiter,
      player,
      opponent,
    };
  }

  /**
   * Internal: populate one Player's zones from the per-player scenario.
   */
  private placePlayer(state: State, p: Player, idx: 0 | 1): void {
    const ps = this.config.players[idx];

    // Active Pokemon. If null, place a default Dreepy so the game has a
    // legal active (the engine requires both players to have an active
    // Pokemon during PLAYER_TURN).
    const active = ps.active ?? { pokemon: 'Dreepy TWM' };
    placePokemonOnList(state, p.active, active);

    // Bench
    for (let i = 0; i < ps.bench.length && i < p.bench.length; i++) {
      placePokemonOnList(state, p.bench[i], ps.bench[i]);
    }

    // Hand
    for (const cardName of ps.hand) {
      const c = makeCard(cardName);
      registerCard(state, c);
      p.hand.cards.push(c);
    }

    // Discard
    for (const cardName of ps.discard) {
      const c = makeCard(cardName);
      registerCard(state, c);
      p.discard.cards.push(c);
    }

    // Deck. deckTop pushed first (front of deck = top), then deckRest, then
    // filler so the deck has a realistic ~30+ cards. The filler matches the
    // card-test-harness DEFAULT_DECK_FILLER convention so search effects
    // (Ultra Ball, Buddy-Buddy Poffin) have a meaningful pool.
    p.deck = new CardList();
    p.deck.isSecret = true;
    for (const cardName of ps.deckTop) {
      const c = makeCard(cardName);
      registerCard(state, c);
      p.deck.cards.push(c);
    }
    for (const cardName of ps.deckRest) {
      const c = makeCard(cardName);
      registerCard(state, c);
      p.deck.cards.push(c);
    }
    // Filler if deck would otherwise be very thin.
    while (p.deck.cards.length < 20) {
      const filler = makeCard('Psychic Energy EVO');
      registerCard(state, filler);
      p.deck.cards.push(filler);
    }

    // Prizes — pull from the END of the deck (not the top), so the
    // caller's `deckTop` cards are preserved. The prize identity is
    // arbitrary for L4/L5 tests; what matters is the count and that the
    // deck-top cards are still where the test expects them.
    //
    // We honor the prizesRemaining knob: a value < 6 means the player has
    // already taken (6 - n) prizes, so we place only n prize CardLists.
    for (let i = 0; i < ps.prizesRemaining; i++) {
      const prize = new CardList();
      prize.isSecret = true;
      if (p.deck.cards.length > 0) {
        // Pop the LAST card from the deck and put it in the prize.
        const last = p.deck.cards.pop()!;
        prize.cards.push(last);
      }
      p.prizes.push(prize);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (mirror card-test-harness internals — kept private here so
// the harness's options-style API stays clean)
// ---------------------------------------------------------------------------

function buildEmptyPlayer(id: number, name: string): Player {
  const p = new Player();
  p.id = id;
  p.name = name;
  // 5 bench slots — Area Zero Underdepths can extend bench size dynamically
  // via state.players[i].bench.push, but the L4 tests start with the standard
  // 5-slot bench and expand only if the test specifically exercises Area Zero.
  for (let i = 0; i < 5; i++) {
    const bench = new PokemonCardList();
    bench.isPublic = true;
    p.bench.push(bench);
  }
  p.active.isPublic = true;
  p.discard.isPublic = true;
  p.stadium.isPublic = true;
  p.supporter.isPublic = true;
  return p;
}

function makeCard(cardName: string): Card {
  const card = CardManager.getInstance().getCardByName(cardName);
  if (card === undefined) {
    throw new Error(`scenario-builder: card not found in registry: "${cardName}"`);
  }
  return card;
}

function registerCard(state: State, card: Card): void {
  card.id = state.cardNames.length;
  state.cardNames.push(card.fullName);
}

/**
 * Place a Pokemon onto a slot with optional energies, tool, damage, and
 * special conditions. Mirrors `placePokemon` in card-test-harness.ts.
 */
function placePokemonOnList(state: State, slot: PokemonCardList, scenario: PokemonScenario): void {
  const card = makeCard(scenario.pokemon);
  if (!(card instanceof PokemonCard)) {
    throw new Error(`scenario-builder: ${scenario.pokemon} is not a PokemonCard`);
  }
  registerCard(state, card);
  slot.cards.push(card);
  // pokemonPlayedTurn = 0 means "played before turn 1", so it can evolve
  // immediately at any turn >= 1. The L4/L5 tests rarely care, but it
  // prevents POKEMON_CANT_EVOLVE_THIS_TURN false-rejects.
  slot.pokemonPlayedTurn = 0;
  if (scenario.damage !== undefined) {
    slot.damage = scenario.damage;
  }
  if (scenario.energies) {
    for (const energyName of scenario.energies) {
      const energy = makeCard(energyName);
      registerCard(state, energy);
      slot.cards.push(energy);
    }
  }
  if (scenario.tool) {
    const tool = makeCard(scenario.tool);
    registerCard(state, tool);
    slot.cards.push(tool);
    slot.tool = tool;
  }
  if (scenario.conditions) {
    for (const cond of scenario.conditions) {
      slot.specialConditions.push(cond);
    }
  }
}
