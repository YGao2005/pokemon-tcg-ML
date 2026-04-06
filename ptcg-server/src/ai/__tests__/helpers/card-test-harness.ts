/**
 * card-test-harness.ts — shared utilities for L2/L3 card validation tests.
 *
 * Plan 01-03 needs to:
 *   1. Build a realistic PLAYER_TURN game state with specific cards in
 *      specific zones (active, bench, hand, discard, deck).
 *   2. Inject a target card into the player's hand and dispatch a
 *      PlayCardAction for it.
 *   3. Auto-resolve any prompts the card creates (via the SeededArbiter +
 *      SeededRNG sub-choice resolver from env.ts).
 *   4. Capture crashes vs clean GameErrors so the test can assert.
 *
 * Why not just use Env.reset()?
 *   Env.reset() walks through the full setup phase (mulligans, choose
 *   starting Pokemon, going-first coin flip). For card unit tests we want
 *   deterministic, fully-controlled scaffolding — e.g. "Dragapult ex on
 *   active with 3 energies attached, opponent has Dreepy active and Duskull
 *   on bench". The smoke-test.js script in this repo already established the
 *   pattern of constructing a State directly. We follow that pattern but
 *   wrap it in cleaner helpers, AND we route prompt resolution through the
 *   same Env code path so test behavior matches production behavior.
 *
 * Design rule: this helper directly mutates state for test scaffolding
 * (injecting cards, pre-damaging Pokemon, etc.). This is only legal in test
 * files — never import this from production code.
 */

import { Store } from '../../../game/store/store';
import { State, GamePhase } from '../../../game/store/state/state';
import { Player } from '../../../game/store/state/player';
import { CardList } from '../../../game/store/state/card-list';
import { PokemonCardList } from '../../../game/store/state/pokemon-card-list';
import { Card } from '../../../game/store/card/card';
import { PokemonCard } from '../../../game/store/card/pokemon-card';
import { TrainerCard } from '../../../game/store/card/trainer-card';
import { EnergyCard } from '../../../game/store/card/energy-card';
import { TrainerType, SuperType, Stage } from '../../../game/store/card/card-types';
import { CardManager } from '../../../game/cards/card-manager';
import { StateUtils } from '../../../game/store/state-utils';
import {
  PlayCardAction, PlayerType, SlotType, CardTarget
} from '../../../game/store/actions/play-card-action';
import { Action } from '../../../game/store/actions/action';
import { ResolvePromptAction } from '../../../game/store/actions/resolve-prompt-action';
import { Prompt } from '../../../game/store/prompts/prompt';
import { ShuffleDeckPrompt } from '../../../game/store/prompts/shuffle-prompt';
import { CoinFlipPrompt } from '../../../game/store/prompts/coin-flip-prompt';
import { ChooseCardsPrompt } from '../../../game/store/prompts/choose-cards-prompt';
import { ChoosePokemonPrompt } from '../../../game/store/prompts/choose-pokemon-prompt';
import { ChoosePrizePrompt } from '../../../game/store/prompts/choose-prize-prompt';
import { AlertPrompt } from '../../../game/store/prompts/alert-prompt';
import { ConfirmPrompt } from '../../../game/store/prompts/confirm-prompt';
import { ShowCardsPrompt } from '../../../game/store/prompts/show-cards-prompt';
import { SelectPrompt } from '../../../game/store/prompts/select-prompt';
import { OrderCardsPrompt } from '../../../game/store/prompts/order-cards-prompt';
import { PutDamagePrompt } from '../../../game/store/prompts/put-damage-prompt';
import { MoveDamagePrompt } from '../../../game/store/prompts/move-damage-prompt';
import { ChooseEnergyPrompt, EnergyMap } from '../../../game/store/prompts/choose-energy-prompt';
import { CardType } from '../../../game/store/card/card-types';
import { GameError } from '../../../game/game-error';
import { SeededRNG } from '../../seeded-rng';
import { SeededArbiter } from '../../seeded-arbiter';
import * as sets from '../../../sets';

// ---------------------------------------------------------------------------
// CardManager bootstrap (singleton — only init once per process)
// ---------------------------------------------------------------------------

let cardManagerInitialized = false;
export function ensureCardManagerInitialized(): void {
  if (cardManagerInitialized) return;
  const cm = CardManager.getInstance();
  if (cm.getAllCards().length === 0) {
    cm.defineSet((sets as any).setDiamondAndPearl);
    cm.defineSet((sets as any).setOp9);
    cm.defineSet((sets as any).setHgss);
    cm.defineSet((sets as any).setBlackAndWhite);
    cm.defineSet((sets as any).setBlackAndWhite2);
    cm.defineSet((sets as any).setBlackAndWhite3);
    cm.defineSet((sets as any).setBlackAndWhite4);
    cm.defineSet((sets as any).setXY);
    cm.defineSet((sets as any).setSunAndMoon);
    cm.defineSet((sets as any).setSwordAndShield);
    cm.defineSet((sets as any).setScarletAndViolet);
  }
  cardManagerInitialized = true;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CardTestContext {
  store: Store;
  state: State;
  rng: SeededRNG;
  arbiter: SeededArbiter;
  player: Player;     // active player (= player 0 by default)
  opponent: Player;
}

export interface ActiveSetup {
  player: 0 | 1;
  pokemon: string;       // fullName, e.g. 'Dragapult ex TWM'
  damage?: number;
  energies?: string[];   // energy fullNames to attach
  tool?: string;         // tool fullName
}

export interface BenchSetup {
  player: 0 | 1;
  pokemon: string[];     // up to 5 Pokemon (or 8 if Area Zero is active)
}

export interface DiscardSetup {
  player: 0 | 1;
  cards: string[];
}

export interface CardTestOptions {
  seed?: number;                 // default: 42
  turn?: number;                 // default: 1 (set to 2+ for evolutions)
  activeSetup?: ActiveSetup[];   // default: empty Pokemon for both
  benchSetup?: BenchSetup[];     // default: empty bench for both
  handCards?: string[];          // cards in player 0's hand (besides default 7-card draw)
  opponentHandCards?: string[];  // cards in player 1's hand
  discardSetup?: DiscardSetup[]; // pre-populate discard pile
  deckCards?: string[];          // override player 0's deck (default: 60 stock cards)
  opponentDeckCards?: string[];  // override player 1's deck
  stadiumInPlay?: string | null; // optional stadium fullName
  prizes?: number;               // prizes per player (default: 6)
  // If true, skip the default 7-card hand draw — only handCards goes into hand.
  noDefaultHand?: boolean;
}

export interface PlayCardResult {
  /** True if a non-GameError exception bubbled up (test failure case). */
  crashed: boolean;
  /** True if a GameError was thrown (expected for "must GameError" tests). */
  gameError: boolean;
  /** Error message if anything went wrong, otherwise undefined. */
  error?: string;
  /** Truncated stack trace (top 5 frames) for diagnostic logging. */
  stackTop?: string;
  /** Number of prompts auto-resolved during the play. */
  promptsResolved: number;
  /** Final state after the play attempt. */
  state: State;
}

// ---------------------------------------------------------------------------
// Internal: build a fresh card instance by name (CardManager clones it)
// ---------------------------------------------------------------------------

function makeCard(cardName: string): Card {
  const card = CardManager.getInstance().getCardByName(cardName);
  if (card === undefined) {
    throw new Error(`card-test-harness: card not found in registry: "${cardName}"`);
  }
  return card;
}

// ---------------------------------------------------------------------------
// Internal: build a fresh Player with the standard zone shape
// ---------------------------------------------------------------------------

function buildPlayer(id: number, name: string, prizesCount: number): Player {
  const p = new Player();
  p.id = id;
  p.name = name;
  for (let i = 0; i < prizesCount; i++) {
    const prize = new CardList();
    prize.isSecret = true;
    p.prizes.push(prize);
  }
  // Standard 5-bench. Plan 01-03 only tests up to 5 — bench expansion via
  // Area Zero is exercised in the Area Zero L3 test which adds slots
  // explicitly when needed.
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

// ---------------------------------------------------------------------------
// Internal: assign card.id and register with state.cardNames
// ---------------------------------------------------------------------------

function registerCard(state: State, card: Card): void {
  card.id = state.cardNames.length;
  state.cardNames.push(card.fullName);
}

// ---------------------------------------------------------------------------
// Internal: place a Pokemon (with optional energies/tool/damage) into a slot
// ---------------------------------------------------------------------------

function placePokemon(state: State, slot: PokemonCardList, setup: { pokemon: string; damage?: number; energies?: string[]; tool?: string }): void {
  const card = makeCard(setup.pokemon);
  if (!(card instanceof PokemonCard)) {
    throw new Error(`card-test-harness: ${setup.pokemon} is not a PokemonCard`);
  }
  registerCard(state, card);
  slot.cards.push(card);
  slot.pokemonPlayedTurn = 0;  // played "before" turn 1, so it can evolve turn 2
  if (setup.damage !== undefined) {
    slot.damage = setup.damage;
  }
  if (setup.energies) {
    for (const energyName of setup.energies) {
      const energy = makeCard(energyName);
      registerCard(state, energy);
      slot.cards.push(energy);
    }
  }
  if (setup.tool) {
    const tool = makeCard(setup.tool);
    registerCard(state, tool);
    slot.cards.push(tool);
    slot.tool = tool;
  }
}

// ---------------------------------------------------------------------------
// Public: build a CardTestContext from CardTestOptions
// ---------------------------------------------------------------------------

const DEFAULT_DECK_FILLER = [
  // 60 stock cards — provides a realistic deck size for cards that need to
  // search the deck (Ultra Ball, Buddy-Buddy Poffin, Crispin, etc).
  ...Array(20).fill('Dreepy TWM'),
  ...Array(20).fill('Psychic Energy EVO'),
  ...Array(10).fill('Fire Energy EVO'),
  ...Array(10).fill('Darkness Energy EVO'),
];

export function buildCardTestContext(opts: CardTestOptions = {}): CardTestContext {
  ensureCardManagerInitialized();

  const seed = opts.seed ?? 42;
  const rng = new SeededRNG(seed);
  const arbiter = new SeededArbiter(rng);

  const handler = { onStateChange: () => { /* noop */ } };
  const store = new Store(handler);
  const state = store.state;
  state.cardNames = [];

  const prizesCount = opts.prizes ?? 6;
  const player = buildPlayer(1, 'P1', prizesCount);
  const opponent = buildPlayer(2, 'P2', prizesCount);
  state.players = [player, opponent];
  state.activePlayer = 0;
  state.phase = GamePhase.PLAYER_TURN;
  state.turn = opts.turn ?? 1;

  // Decks: build first so cards exist for prizes/hand/discard.
  const buildDeck = (cards: string[], target: Player) => {
    target.deck = new CardList();
    target.deck.isSecret = true;
    for (const name of cards) {
      const c = makeCard(name);
      registerCard(state, c);
      target.deck.cards.push(c);
    }
  };
  buildDeck(opts.deckCards ?? DEFAULT_DECK_FILLER, player);
  buildDeck(opts.opponentDeckCards ?? DEFAULT_DECK_FILLER, opponent);

  // Active Pokemon. If not specified, both players need a Basic for the game
  // to be in a legal PLAYER_TURN state. Default: a Dreepy each.
  const activeP0 = opts.activeSetup?.find(s => s.player === 0);
  const activeP1 = opts.activeSetup?.find(s => s.player === 1);
  placePokemon(state, player.active, activeP0 ?? { pokemon: 'Dreepy TWM' });
  placePokemon(state, opponent.active, activeP1 ?? { pokemon: 'Dreepy TWM' });

  // Bench
  const benchP0 = opts.benchSetup?.find(s => s.player === 0);
  if (benchP0) {
    benchP0.pokemon.forEach((name, i) => {
      if (i >= player.bench.length) return;
      placePokemon(state, player.bench[i], { pokemon: name });
    });
  }
  const benchP1 = opts.benchSetup?.find(s => s.player === 1);
  if (benchP1) {
    benchP1.pokemon.forEach((name, i) => {
      if (i >= opponent.bench.length) return;
      placePokemon(state, opponent.bench[i], { pokemon: name });
    });
  }

  // Prizes — pull from each player's deck (1 card per prize slot).
  for (let i = 0; i < prizesCount; i++) {
    if (player.deck.cards.length > 0) player.deck.moveTo(player.prizes[i], 1);
    if (opponent.deck.cards.length > 0) opponent.deck.moveTo(opponent.prizes[i], 1);
  }

  // Default 7-card hand draw (unless suppressed). This mimics the start of a
  // real game and gives Lillie's Determination etc. a sane hand to work with.
  if (!opts.noDefaultHand) {
    player.deck.moveTo(player.hand, Math.min(7, player.deck.cards.length));
    opponent.deck.moveTo(opponent.hand, Math.min(7, opponent.deck.cards.length));
  }

  // Inject extra hand cards (these come AFTER the default draw, so the
  // target card is at the top of the hand for predictable indexing).
  if (opts.handCards) {
    for (const name of opts.handCards) {
      const c = makeCard(name);
      registerCard(state, c);
      player.hand.cards.push(c);
    }
  }
  if (opts.opponentHandCards) {
    for (const name of opts.opponentHandCards) {
      const c = makeCard(name);
      registerCard(state, c);
      opponent.hand.cards.push(c);
    }
  }

  // Discard setup
  if (opts.discardSetup) {
    for (const setup of opts.discardSetup) {
      const target = setup.player === 0 ? player : opponent;
      for (const name of setup.cards) {
        const c = makeCard(name);
        registerCard(state, c);
        target.discard.cards.push(c);
      }
    }
  }

  // Stadium
  if (opts.stadiumInPlay) {
    const stadium = makeCard(opts.stadiumInPlay);
    registerCard(state, stadium);
    player.stadium.cards.push(stadium);
  }

  return { store, state: store.state, rng, arbiter, player, opponent };
}

// ---------------------------------------------------------------------------
// Public: inject a card into the active player's hand
// ---------------------------------------------------------------------------

export function injectCardIntoHand(ctx: CardTestContext, cardName: string): Card {
  const card = makeCard(cardName);
  registerCard(ctx.state, card);
  ctx.player.hand.cards.push(card);
  return card;
}

// ---------------------------------------------------------------------------
// Public: find a Pokemon in play (active or bench) by name
// ---------------------------------------------------------------------------

export function findPokemonInPlay(state: State, name: string, playerIdx: 0 | 1): PokemonCardList | null {
  const p = state.players[playerIdx];
  if (!p) return null;
  if (p.active.getPokemonCard()?.name === name || p.active.getPokemonCard()?.fullName === name) {
    return p.active;
  }
  for (const b of p.bench) {
    const pc = b.getPokemonCard();
    if (pc?.name === name || pc?.fullName === name) {
      return b;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: count damage on a slot
// ---------------------------------------------------------------------------

export function getDamage(pokemon: PokemonCardList): number {
  return pokemon.damage;
}

// ---------------------------------------------------------------------------
// Internal: pick a default CardTarget for a card based on type
// ---------------------------------------------------------------------------

function defaultTargetForCard(player: Player, card: Card): CardTarget {
  if (card instanceof EnergyCard) {
    return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  }
  if (card instanceof PokemonCard) {
    // Basics → first empty bench slot. Evolutions → active (so they evolve
    // the card already there). The harness lets the caller override via
    // playCardWithTarget if a more specific target is needed.
    if (card.stage === Stage.BASIC) {
      const emptyIdx = player.bench.findIndex(b => b.cards.length === 0);
      if (emptyIdx !== -1) {
        return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: emptyIdx };
      }
      return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    }
    return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
  }
  // Trainer / Tool → board (the engine routes by trainerType anyway).
  if (card instanceof TrainerCard) {
    if (card.trainerType === TrainerType.TOOL) {
      return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    }
    return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BOARD, index: 0 };
  }
  return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BOARD, index: 0 };
}

// ---------------------------------------------------------------------------
// Public: dispatch any Action and capture the result (with prompt resolution)
// ---------------------------------------------------------------------------

export function dispatchAction(ctx: CardTestContext, action: Action): PlayCardResult {
  let crashed = false;
  let gameError = false;
  let error: string | undefined;
  let stackTop: string | undefined;
  let promptsResolved = 0;

  try {
    ctx.store.dispatch(action);
  } catch (err: any) {
    const isGE = err instanceof GameError ||
      (err && err.constructor && err.constructor.name === 'GameError');
    if (isGE) {
      gameError = true;
    } else {
      crashed = true;
    }
    error = err && err.message ? err.message : String(err);
    stackTop = err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : undefined;
    return {
      crashed, gameError, error, stackTop,
      promptsResolved,
      state: ctx.store.state,
    };
  }

  // Auto-resolve any prompts the action created.
  try {
    promptsResolved = resolvePrompts(ctx);
  } catch (err: any) {
    const isGE = err instanceof GameError ||
      (err && err.constructor && err.constructor.name === 'GameError');
    if (isGE) {
      gameError = true;
    } else {
      crashed = true;
    }
    error = err && err.message ? err.message : String(err);
    stackTop = err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : undefined;
  }

  return {
    crashed, gameError, error, stackTop,
    promptsResolved,
    state: ctx.store.state,
  };
}

// ---------------------------------------------------------------------------
// Public: play a named card from the active player's hand
// ---------------------------------------------------------------------------

export function playCard(
  ctx: CardTestContext,
  cardName: string,
  targetOverride?: CardTarget
): PlayCardResult {
  // Find the card in hand by fullName.
  const handIndex = ctx.player.hand.cards.findIndex(c => c.fullName === cardName);
  if (handIndex === -1) {
    return {
      crashed: false,
      gameError: false,
      error: `card-test-harness: card "${cardName}" not in hand (hand=[${ctx.player.hand.cards.map(c => c.fullName).join(', ')}])`,
      promptsResolved: 0,
      state: ctx.state,
    };
  }
  const card = ctx.player.hand.cards[handIndex];
  const target = targetOverride ?? defaultTargetForCard(ctx.player, card);
  const action = new PlayCardAction(ctx.player.id, handIndex, target);
  return dispatchAction(ctx, action);
}

// ---------------------------------------------------------------------------
// Public: assertion helper used by spec files (non-throwing inspection)
// ---------------------------------------------------------------------------

export function expectNoCrash(result: PlayCardResult, label: string): void {
  if (result.crashed) {
    throw new Error(
      `${label}: CRASH (non-GameError): ${result.error}\n${result.stackTop ?? ''}`
    );
  }
}

export function expectCleanGameError(result: PlayCardResult, label: string): void {
  if (result.crashed) {
    throw new Error(
      `${label}: expected GameError but got CRASH: ${result.error}\n${result.stackTop ?? ''}`
    );
  }
  if (!result.gameError) {
    throw new Error(`${label}: expected a GameError but action succeeded`);
  }
}

// ---------------------------------------------------------------------------
// Prompt resolution loop (mirrors env.ts but standalone — test infrastructure
// needs to live independently of env.ts so spec-only fixes don't pollute the
// production resolver).
// ---------------------------------------------------------------------------

const MAX_PROMPT_ITERATIONS = 100;

function resolvePrompts(ctx: CardTestContext): number {
  let iters = 0;
  let resolved = 0;
  while (iters++ < MAX_PROMPT_ITERATIONS) {
    const unresolved = ctx.store.state.prompts.filter(p => p.result === undefined);
    if (unresolved.length === 0) {
      return resolved;
    }
    const prompt = unresolved[0];
    const action = buildResolveAction(ctx, prompt);
    if (action === undefined) {
      throw new Error(
        `card-test-harness: cannot resolve prompt of type ${prompt.constructor.name}`
      );
    }
    ctx.store.dispatch(action);
    resolved++;
  }
  throw new Error(`card-test-harness: prompt resolution exceeded ${MAX_PROMPT_ITERATIONS} iterations (likely infinite loop in card effect)`);
}

function buildResolveAction(ctx: CardTestContext, prompt: Prompt<any>): ResolvePromptAction | undefined {
  const state = ctx.store.state;
  const rng = ctx.rng;

  // Mechanical prompts via SeededArbiter.
  if (prompt instanceof ShuffleDeckPrompt || prompt instanceof CoinFlipPrompt) {
    const action = ctx.arbiter.resolvePrompt(state, prompt);
    if (action !== undefined) return action;
  }

  if (prompt instanceof AlertPrompt) {
    return new ResolvePromptAction(prompt.id, true);
  }
  if (prompt instanceof ConfirmPrompt) {
    return new ResolvePromptAction(prompt.id, true);
  }
  if (prompt instanceof ShowCardsPrompt) {
    return new ResolvePromptAction(prompt.id, true);
  }

  if (prompt instanceof ChooseCardsPrompt) {
    const candidates = prompt.cards.cards.filter((c, idx) => {
      if (prompt.options.blocked.includes(idx)) return false;
      return matchesFilter(c, prompt.filter);
    });
    const need = Math.max(prompt.options.min, 0);
    if (candidates.length < need) {
      if (prompt.options.allowCancel) {
        return new ResolvePromptAction(prompt.id, null);
      }
      return new ResolvePromptAction(prompt.id, candidates);
    }
    const picked = sampleWithoutReplacement(candidates, need, rng);
    return new ResolvePromptAction(prompt.id, picked);
  }

  if (prompt instanceof ChoosePokemonPrompt) {
    const player = state.players.find(p => p.id === prompt.playerId);
    const opp = state.players.find(p => p.id !== prompt.playerId);
    if (player === undefined || opp === undefined) {
      return new ResolvePromptAction(prompt.id, null);
    }
    // Honor prompt.options.blocked (added Plan 01-06). Rare Candy etc.
    // push wrong-line targets into `blocked` and rely on the resolver to
    // filter them. Without this, the resolver may hand back a blocked list
    // → validate() rejects → card silently no-ops.
    const blockedLists = prompt.options.blocked.map(
      b => StateUtils.getTarget(state, player, b)
    );
    const candidates: PokemonCardList[] = [];
    const include = (cl: PokemonCardList) => {
      if (cl.cards.length === 0) return;
      if (blockedLists.includes(cl)) return;
      candidates.push(cl);
    };
    const collectFor = (p: Player) => {
      if (prompt.slots.includes(SlotType.ACTIVE)) include(p.active);
      if (prompt.slots.includes(SlotType.BENCH)) {
        for (const b of p.bench) include(b);
      }
    };
    if (prompt.playerType === PlayerType.BOTTOM_PLAYER || prompt.playerType === PlayerType.ANY) {
      collectFor(player);
    }
    if (prompt.playerType === PlayerType.TOP_PLAYER || prompt.playerType === PlayerType.ANY) {
      collectFor(opp);
    }
    const need = Math.max(prompt.options.min, 0);
    if (candidates.length < need) {
      if (prompt.options.allowCancel) {
        return new ResolvePromptAction(prompt.id, null);
      }
      return new ResolvePromptAction(prompt.id, candidates);
    }
    const picked = sampleWithoutReplacement(candidates, need, rng);
    return new ResolvePromptAction(prompt.id, picked);
  }

  if (prompt instanceof ChoosePrizePrompt) {
    const player = state.players.find(p => p.id === prompt.playerId);
    if (player === undefined) {
      return new ResolvePromptAction(prompt.id, null);
    }
    const remaining = player.prizes.filter(pr => pr.cards.length > 0);
    const need = prompt.options.count;
    if (remaining.length < need) {
      if (prompt.options.allowCancel) {
        return new ResolvePromptAction(prompt.id, null);
      }
      return new ResolvePromptAction(prompt.id, remaining);
    }
    const picked = sampleWithoutReplacement(remaining, need, rng);
    return new ResolvePromptAction(prompt.id, picked);
  }

  if (prompt instanceof SelectPrompt) {
    const n = prompt.values.length;
    const choice = n > 0 ? rng.nextInt(n) : 0;
    return new ResolvePromptAction(prompt.id, choice);
  }

  if (prompt instanceof OrderCardsPrompt) {
    const indices: number[] = [];
    for (let i = 0; i < prompt.cards.cards.length; i++) indices.push(i);
    return new ResolvePromptAction(prompt.id, indices);
  }

  // PutDamagePrompt — distribute the requested damage in 10-counter chunks
  // across legal targets. Used by Phantom Dive, Cursed Blast.
  if (prompt instanceof PutDamagePrompt) {
    const player = state.players.find(p => p.id === prompt.playerId);
    const opp = state.players.find(p => p.id !== prompt.playerId);
    if (player === undefined || opp === undefined) {
      if (prompt.options.allowCancel) return new ResolvePromptAction(prompt.id, null);
      return new ResolvePromptAction(prompt.id, []);
    }
    const targetsList: { target: CardTarget; pcl: PokemonCardList }[] = [];
    const collect = (p: Player, who: PlayerType) => {
      if (prompt.slots.includes(SlotType.ACTIVE) && p.active.cards.length > 0) {
        targetsList.push({ target: { player: who, slot: SlotType.ACTIVE, index: 0 }, pcl: p.active });
      }
      if (prompt.slots.includes(SlotType.BENCH)) {
        for (let i = 0; i < p.bench.length; i++) {
          if (p.bench[i].cards.length > 0) {
            targetsList.push({ target: { player: who, slot: SlotType.BENCH, index: i }, pcl: p.bench[i] });
          }
        }
      }
    };
    if (prompt.playerType === PlayerType.BOTTOM_PLAYER || prompt.playerType === PlayerType.ANY) {
      collect(player, PlayerType.BOTTOM_PLAYER);
    }
    if (prompt.playerType === PlayerType.TOP_PLAYER || prompt.playerType === PlayerType.ANY) {
      collect(opp, PlayerType.TOP_PLAYER);
    }
    if (targetsList.length === 0) {
      if (prompt.options.allowCancel) return new ResolvePromptAction(prompt.id, null);
      return new ResolvePromptAction(prompt.id, []);
    }
    // Distribute prompt.damage across targets in 10-damage chunks. Greedy:
    // place the first chunk on the first target, the next on the second, etc.
    // For Phantom Dive (damage=60) over 1-5 bench targets, this matches the
    // human "spread evenly" intuition.
    const result: { target: CardTarget; damage: number }[] = [];
    let remaining = prompt.damage;
    let i = 0;
    while (remaining > 0) {
      const tgt = targetsList[i % targetsList.length];
      const existing = result.find(r => r.target === tgt.target);
      const chunk = Math.min(10, remaining);
      if (existing) {
        existing.damage += chunk;
      } else {
        result.push({ target: tgt.target, damage: chunk });
      }
      remaining -= chunk;
      i++;
      if (i > 1000) break;  // safety
    }
    return new ResolvePromptAction(prompt.id, result);
  }

  // MoveDamagePrompt — pick a legal source/destination pair and return a
  // single 1-counter transfer. Strategy depends on `prompt.playerType`:
  //   - BOTTOM_PLAYER / TOP_PLAYER: same-side move (Sinister Hand pattern)
  //   - ANY: cross-side move (Munkidori Adrena-Brain pattern, bias to
  //     player's side → opponent's side; the card filters in callback)
  //
  // Mirrors env.ts handler so harness tests and self-play behave identically.
  // Updated in Plan 01-05: previously this returned null/empty (cancel),
  // which made Adrena-Brain L5 assertions impossible to verify.
  if (prompt instanceof MoveDamagePrompt) {
    const player = state.players.find(p => p.id === prompt.playerId);
    const opp = state.players.find(p => p.id !== prompt.playerId);
    if (player === undefined || opp === undefined) {
      if (prompt.options.allowCancel) return new ResolvePromptAction(prompt.id, null);
      return new ResolvePromptAction(prompt.id, []);
    }
    const collectFromPlayer = (p: Player, who: PlayerType) => {
      const out: { target: CardTarget; pcl: PokemonCardList }[] = [];
      if (prompt.slots.includes(SlotType.ACTIVE) && p.active.cards.length > 0) {
        out.push({ target: { player: who, slot: SlotType.ACTIVE, index: 0 }, pcl: p.active });
      }
      if (prompt.slots.includes(SlotType.BENCH)) {
        for (let i = 0; i < p.bench.length; i++) {
          if (p.bench[i].cards.length > 0) {
            out.push({ target: { player: who, slot: SlotType.BENCH, index: i }, pcl: p.bench[i] });
          }
        }
      }
      return out;
    };
    const playerSlots = collectFromPlayer(player, PlayerType.BOTTOM_PLAYER);
    const oppSlots = collectFromPlayer(opp, PlayerType.TOP_PLAYER);

    let sourceCandidates: { target: CardTarget; pcl: PokemonCardList }[] = [];
    let destCandidates: { target: CardTarget; pcl: PokemonCardList }[] = [];

    if (prompt.playerType === PlayerType.BOTTOM_PLAYER) {
      sourceCandidates = playerSlots;
      destCandidates = playerSlots;
    } else if (prompt.playerType === PlayerType.TOP_PLAYER) {
      sourceCandidates = oppSlots;
      destCandidates = oppSlots;
    } else {
      // ANY: bias to cross-side (player → opponent).
      sourceCandidates = playerSlots;
      destCandidates = oppSlots;
    }

    const sourceIdx = sourceCandidates.findIndex(t => t.pcl.damage >= 10);
    if (sourceIdx === -1) {
      if (prompt.options.allowCancel) return new ResolvePromptAction(prompt.id, null);
      return new ResolvePromptAction(prompt.id, []);
    }
    const source = sourceCandidates[sourceIdx];
    const destIdx = destCandidates.findIndex(t => t.pcl !== source.pcl);
    if (destIdx === -1) {
      if (prompt.options.allowCancel) return new ResolvePromptAction(prompt.id, null);
      return new ResolvePromptAction(prompt.id, []);
    }
    return new ResolvePromptAction(prompt.id, [{
      from: source.target,
      to: destCandidates[destIdx].target,
    }]);
  }

  // ChooseEnergyPrompt — greedy match concrete cost types, then fill
  // colorless slots. Mirrors env.ts. Added in Plan 01-05 so Crispin and
  // Night Stretcher (when used as energy tutors) can be exercised in L4/L5
  // tests via the harness.
  if (prompt instanceof ChooseEnergyPrompt) {
    const pool: EnergyMap[] = prompt.energy.slice();
    const picked: EnergyMap[] = [];
    const cost = prompt.cost.slice();
    for (let i = cost.length - 1; i >= 0; i--) {
      const c = cost[i];
      if (c === CardType.COLORLESS) continue;
      const idx = pool.findIndex(e => e.provides.includes(c));
      if (idx === -1) continue;
      picked.push(pool[idx]);
      pool.splice(idx, 1);
      cost.splice(i, 1);
    }
    const colorlessNeeded = cost.filter(c => c === CardType.COLORLESS).length;
    for (let i = 0; i < colorlessNeeded && pool.length > 0; i++) {
      picked.push(pool[0]);
      pool.splice(0, 1);
    }
    if (picked.length === 0 && prompt.options.allowCancel) {
      return new ResolvePromptAction(prompt.id, null);
    }
    const indices = picked.map(e => prompt.energy.indexOf(e)).filter(i => i >= 0);
    return new ResolvePromptAction(prompt.id, indices);
  }

  // Unknown prompt type — best-effort null. The test will likely fail an
  // assertion downstream, which is the right behavior (forces us to extend
  // this resolver).
  return new ResolvePromptAction(prompt.id, null);
}

function matchesFilter(card: Card, filter: any): boolean {
  if (!filter) return true;
  for (const key in filter) {
    if (Object.prototype.hasOwnProperty.call(filter, key)) {
      if ((filter as any)[key] !== (card as any)[key]) {
        return false;
      }
    }
  }
  return true;
}

function sampleWithoutReplacement<T>(arr: T[], n: number, rng: SeededRNG): T[] {
  if (n >= arr.length) return arr.slice();
  const copy = arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    const j = rng.nextInt(copy.length);
    out.push(copy[j]);
    copy.splice(j, 1);
  }
  return out;
}
