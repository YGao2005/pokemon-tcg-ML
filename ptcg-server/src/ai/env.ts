/**
 * Env — environment wrapper around the engine `Store` for the AI pipeline.
 *
 * The Env presents a Gym-style API:
 *   - reset(deckA, deckB, seed) → initial EnvState
 *   - step(envState, action)    → { state, reward, done, info }   [Task 4]
 *   - legalActions(envState)    → Action[]                          [Task 4]
 *   - clone(envState)           → independent EnvState (deep copy + RNG fork)
 *   - hash(envState)            → canonical hex/string
 *   - isTerminal/winner/currentPlayer accessors
 *
 * Key invariants
 * --------------
 * 1. After reset() returns, state.phase === PLAYER_TURN and state.prompts is empty.
 * 2. After step() returns, state.prompts is always empty OR the game is terminal.
 *    Env consumers never see mid-turn prompt state.
 * 3. step() never throws on illegal actions. It catches GameError and any other
 *    exceptions, returns the unchanged state with info.error / info.crashed set.
 *    The self-play harness (built in plan 01-02) needs to count crashes without
 *    dying.
 * 4. clone() forks the RNG so the cloned env has an independent stream from the
 *    original. Two clones from the same state with the same action sequence
 *    will diverge after the first prompt resolution that consumes RNG.
 *
 * Design decisions (ratified in plan 01-01 <design_decisions>)
 * ------------------------------------------------------------
 * DD1 Prompt resolution: auto-resolve mid-turn prompts. Mechanical prompts
 *     (shuffle, coin flip) go through SeededArbiter. Strategic sub-choices
 *     (ChooseCards, ChoosePokemon, Select) use rng.nextInt(N) to pick an index
 *     — NOT hardcoded 0. This is so future MCTS rollouts can diversify via seed
 *     alone. We document the loss of optimality for cards with sub-choices and
 *     revisit in Phase 5.
 * DD2 SeededRNG: hand-rolled xorshift128+. No deps. No Math.random monkey-patch
 *     (would break the Phase 2 worker pool's shared global state).
 * DD3 State API shape: return full State objects (no handle layer in Phase 1).
 * DD4 Decks are string arrays passed to Env.reset(deckA, deckB, seed). Enables
 *     v1.1 novel-deck generalization without rewriting the Env.
 *
 * Citation: ByteDance Hearthstone paper (arXiv:2303.05197) §IV.A wraps the
 * engine in a similar reset/step shape. We adapt for Pokemon TCG's prompt-driven
 * mid-turn control flow.
 */

import { Store } from '../game/store/store';
import { State, GamePhase, GameWinner } from '../game/store/state/state';
import { Action } from '../game/store/actions/action';
import { AddPlayerAction } from '../game/store/actions/add-player-action';
import { ResolvePromptAction } from '../game/store/actions/resolve-prompt-action';
import { PlayerType, SlotType } from '../game/store/actions/play-card-action';
import { Prompt } from '../game/store/prompts/prompt';
import { ShuffleDeckPrompt } from '../game/store/prompts/shuffle-prompt';
import { CoinFlipPrompt } from '../game/store/prompts/coin-flip-prompt';
import { ChooseCardsPrompt } from '../game/store/prompts/choose-cards-prompt';
import { ChoosePokemonPrompt } from '../game/store/prompts/choose-pokemon-prompt';
import { ChoosePrizePrompt } from '../game/store/prompts/choose-prize-prompt';
import { AlertPrompt } from '../game/store/prompts/alert-prompt';
import { ConfirmPrompt } from '../game/store/prompts/confirm-prompt';
import { ShowCardsPrompt } from '../game/store/prompts/show-cards-prompt';
import { SelectPrompt } from '../game/store/prompts/select-prompt';
import { OrderCardsPrompt } from '../game/store/prompts/order-cards-prompt';
import { Card } from '../game/store/card/card';
import { Player } from '../game/store/state/player';
import { PokemonCardList } from '../game/store/state/pokemon-card-list';
import { deepClone } from '../utils/utils';
import { SeededRNG } from './seeded-rng';
import { SeededArbiter } from './seeded-arbiter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvState {
  state: State;
  arbiter: SeededArbiter;
  rng: SeededRNG;
  store: Store;
}

export interface StepInfo {
  error?: string;
  crashed?: boolean;
  promptsResolved?: number;
}

export interface StepResult {
  state: EnvState;
  reward: number;
  done: boolean;
  info: StepInfo;
}

// Player IDs used by Env. Phase 1 hard-codes a 2-player game with stable ids
// so EnvState hashes are stable across runs.
const PLAYER_A_ID = 1;
const PLAYER_B_ID = 2;
const PLAYER_A_NAME = 'P1';
const PLAYER_B_NAME = 'P2';

// Maximum number of prompt-resolution iterations per step. Guards against
// infinite loops if a card creates new prompts on every resolution.
const MAX_PROMPT_ITERATIONS = 100;

// Logged prompt types we encountered during smoke testing but did not implement
// special handling for. The handler picks index 0 / first option as a fallback.
// Plan 01-03 will surface this list and add proper handling.
const observedUnknownPromptTypes = new Set<string>();

// ---------------------------------------------------------------------------
// Env class
// ---------------------------------------------------------------------------

export class Env {

  // The class is stateless at the instance level — all state lives in EnvState.
  // The constructor takes no args.

  /**
   * Initialize a new game with the given decks and seed.
   *
   * @param deckA card-name array for player A (60 cards expected by engine)
   * @param deckB card-name array for player B
   * @param seed  RNG seed; same seed → identical setup, identical mulligans,
   *              identical going-first coin flip, identical starting Pokemon
   *              choices
   * @returns EnvState in PLAYER_TURN phase with no pending prompts
   */
  public reset(deckA: string[], deckB: string[], seed: number): EnvState {
    const rng = new SeededRNG(seed);
    const arbiter = new SeededArbiter(rng);
    const handler = { onStateChange: () => { /* noop */ } };
    const store = new Store(handler);

    // Dispatch AddPlayer for both players. The second AddPlayer triggers the
    // setup-phase generator which creates ShuffleDeck/ChooseCards/CoinFlip
    // prompts.
    store.dispatch(new AddPlayerAction(PLAYER_A_ID, PLAYER_A_NAME, deckA));
    store.dispatch(new AddPlayerAction(PLAYER_B_ID, PLAYER_B_NAME, deckB));

    // Drive the prompt-resolution loop until setup completes.
    const envState: EnvState = { state: store.state, arbiter, rng, store };
    this.resolvePromptsLoop(envState, /* isSetup */ true);

    // Refresh state pointer in case the store reassigned it.
    envState.state = store.state;

    // Sanity check — setup must reach PLAYER_TURN.
    if (envState.state.phase !== GamePhase.PLAYER_TURN) {
      throw new Error(
        `Env.reset: setup did not reach PLAYER_TURN, ended in phase=${envState.state.phase} ` +
        `with ${envState.state.prompts.filter(p => p.result === undefined).length} unresolved prompts`
      );
    }

    return envState;
  }

  /**
   * STUB — implemented in Task 4.
   */
  public step(_envState: EnvState, _action: Action): StepResult {
    throw new Error('Env.step: not yet implemented (lands in plan 01-01 Task 4)');
  }

  /**
   * STUB — implemented in Task 4.
   */
  public legalActions(_envState: EnvState): Action[] {
    throw new Error('Env.legalActions: not yet implemented (lands in plan 01-01 Task 4)');
  }

  /**
   * Deep-clone an EnvState. The new EnvState has:
   *   - a deep-cloned State (cards are kept by reference; everything else is copied)
   *   - a forked SeededRNG (independent stream, deterministic)
   *   - a fresh SeededArbiter wrapping the forked RNG
   *   - a fresh Store
   *
   * IMPORTANT: clones are only safe at turn boundaries (state.prompts empty).
   * Mid-prompt clones are not supported because the Store's promptItems
   * (callbacks) cannot be cloned. Since Env.step() auto-resolves all prompts,
   * EnvStates returned from step() are always at turn boundaries. Calling
   * clone() at any other time is a programmer error.
   */
  public clone(envState: EnvState): EnvState {
    if (envState.state.prompts.some(p => p.result === undefined)) {
      throw new Error('Env.clone: cannot clone an EnvState with unresolved prompts');
    }
    if (envState.store.hasPrompts()) {
      throw new Error('Env.clone: cannot clone an EnvState with pending promptItems in the store');
    }

    // deepClone(state, [Card]) — keeps Card instances by reference. The engine
    // already uses this convention (see store.ts reduce() stateBackup).
    const clonedState = deepClone(envState.state, [Card]) as State;

    // Fork the RNG so the clone has an independent but deterministic stream.
    const newRng = envState.rng.fork();
    const newArbiter = new SeededArbiter(newRng);

    // Build a fresh Store wrapping the cloned state.
    const newHandler = { onStateChange: () => { /* noop */ } };
    const newStore = new Store(newHandler);
    // Replace the store's state with our clone. Accessing state directly is
    // safe because Store.state is a public field.
    (newStore as any).state = clonedState;

    return {
      state: clonedState,
      arbiter: newArbiter,
      rng: newRng,
      store: newStore,
    };
  }

  /**
   * Compute a canonical hash of the EnvState. Phase 1 returns the canonical
   * JSON projection (FNV is unnecessary for the Phase 1 differential
   * reproducibility test — string equality of the canonical projection is
   * sufficient and easier to debug).
   *
   * The projection covers everything that affects gameplay-relevant state at
   * a turn boundary, while ignoring volatile fields like log entries and
   * card-name string interning.
   */
  public hash(envState: EnvState): string {
    const s = envState.state;
    const proj: any = {
      phase: s.phase,
      turn: s.turn,
      activePlayer: s.activePlayer,
      winner: s.winner,
      players: s.players.map(p => ({
        id: p.id,
        name: p.name,
        deckSize: p.deck.cards.length,
        discardSize: p.discard.cards.length,
        lostzoneSize: p.lostzone.cards.length,
        prizes: p.prizes.map(prize => prize.cards.length),
        hand: p.hand.cards.map(c => Env.cardKey(c)),
        active: {
          cards: p.active.cards.map(c => Env.cardKey(c)),
          damage: p.active.damage,
          conditions: p.active.specialConditions.slice().sort(),
        },
        bench: p.bench.map(b => ({
          cards: b.cards.map(c => Env.cardKey(c)),
          damage: b.damage,
          conditions: b.specialConditions.slice().sort(),
        })),
        stadium: p.stadium.cards.map(c => Env.cardKey(c)),
        supporter: p.supporter.cards.map(c => Env.cardKey(c)),
        retreatedTurn: p.retreatedTurn,
        energyPlayedTurn: p.energyPlayedTurn,
        stadiumPlayedTurn: p.stadiumPlayedTurn,
      })),
    };
    return JSON.stringify(proj);
  }

  public isTerminal(envState: EnvState): boolean {
    return envState.state.phase === GamePhase.FINISHED;
  }

  /**
   * Returns the winner player index (0 or 1) if terminal, or null if not.
   * Returns null on a draw too — callers can check `state.winner` directly
   * for finer detail (NONE / PLAYER_1 / PLAYER_2 / DRAW).
   */
  public winner(envState: EnvState): number | null {
    if (!this.isTerminal(envState)) {
      return null;
    }
    const w = envState.state.winner;
    if (w === GameWinner.PLAYER_1) return 0;
    if (w === GameWinner.PLAYER_2) return 1;
    return null;
  }

  public currentPlayer(envState: EnvState): number | null {
    if (this.isTerminal(envState)) {
      return null;
    }
    return envState.state.activePlayer ?? null;
  }

  /**
   * For diagnostics: returns the set of prompt class names encountered during
   * step() that fell through to the unknown-handler. Plan 01-03 uses this to
   * add coverage for any prompts the smoke tests trigger.
   */
  public static getObservedUnknownPromptTypes(): string[] {
    return Array.from(observedUnknownPromptTypes).sort();
  }

  // -------------------------------------------------------------------------
  // Private helpers — used by reset() and (in Task 4) step()
  // -------------------------------------------------------------------------

  /**
   * Drive the prompt-resolution loop on the store. Returns the number of
   * prompts resolved. Throws if MAX_PROMPT_ITERATIONS exceeded.
   *
   * @param isSetup if true, prompts are setup-time prompts (mulligans, choose
   *                starting Pokemon, going-first coin flip). If false, the
   *                prompts arose during a turn action.
   */
  protected resolvePromptsLoop(envState: EnvState, isSetup: boolean): number {
    let iterations = 0;
    let resolved = 0;
    while (iterations++ < MAX_PROMPT_ITERATIONS) {
      const state = envState.store.state;
      const unresolved = state.prompts.filter(p => p.result === undefined);
      if (unresolved.length === 0) {
        envState.state = state;
        return resolved;
      }
      // Resolve the first unresolved prompt and loop again. (Resolving may
      // create new prompts; the next iteration picks them up.)
      const prompt = unresolved[0];
      const action = this.buildResolveActionForPrompt(envState, prompt);
      if (action === undefined) {
        throw new Error(
          `Env.resolvePromptsLoop: could not resolve prompt of type ${prompt.constructor.name} ` +
          `(playerId=${prompt.playerId}, isSetup=${isSetup})`
        );
      }
      envState.store.dispatch(action);
      resolved++;
    }
    throw new Error(`Env.resolvePromptsLoop: exceeded ${MAX_PROMPT_ITERATIONS} iterations`);
  }

  /**
   * Build a ResolvePromptAction for a given prompt, using the SeededArbiter
   * for mechanical prompts and SeededRNG.nextInt for sub-choices.
   */
  protected buildResolveActionForPrompt(
    envState: EnvState,
    prompt: Prompt<any>
  ): ResolvePromptAction | undefined {
    // 1. Mechanical prompts: route through the arbiter.
    if (prompt instanceof ShuffleDeckPrompt || prompt instanceof CoinFlipPrompt) {
      const action = envState.arbiter.resolvePrompt(envState.state, prompt);
      if (action !== undefined) {
        return action;
      }
    }

    const state = envState.state;
    const rng = envState.rng;

    // 2. AlertPrompt — always resolves with `true`.
    if (prompt instanceof AlertPrompt) {
      return new ResolvePromptAction(prompt.id, true);
    }

    // 3. ConfirmPrompt — yes/no. Default to true (accept). The bot can refine.
    if (prompt instanceof ConfirmPrompt) {
      return new ResolvePromptAction(prompt.id, true);
    }

    // 4. ShowCardsPrompt — acknowledge.
    if (prompt instanceof ShowCardsPrompt) {
      return new ResolvePromptAction(prompt.id, true);
    }

    // 5. ChooseCardsPrompt — pick `min` cards matching the filter, sampled
    //    via SeededRNG (without replacement).
    if (prompt instanceof ChooseCardsPrompt) {
      const candidates = prompt.cards.cards.filter((c, idx) => {
        if (prompt.options.blocked.includes(idx)) return false;
        return Env.matchesFilter(c, prompt.filter);
      });
      const need = Math.max(prompt.options.min, 0);
      if (candidates.length < need) {
        if (prompt.options.allowCancel) {
          return new ResolvePromptAction(prompt.id, null);
        }
        // Cannot satisfy — return what we have, the engine will validate.
        return new ResolvePromptAction(prompt.id, candidates);
      }
      // Sample `need` distinct candidates via Fisher-Yates partial shuffle.
      const picked = Env.sampleWithoutReplacement(candidates, need, rng);
      return new ResolvePromptAction(prompt.id, picked);
    }

    // 6. ChoosePokemonPrompt — pick `min` valid PokemonCardLists. The
    //    `decode` step normally translates CardTarget[] → PokemonCardList[],
    //    but since we resolve directly, we pass PokemonCardList[] (the
    //    callback's expected input type).
    if (prompt instanceof ChoosePokemonPrompt) {
      const player = state.players.find(p => p.id === prompt.playerId);
      const opponent = state.players.find(p => p.id !== prompt.playerId);
      if (player === undefined || opponent === undefined) {
        return new ResolvePromptAction(prompt.id, null);
      }
      const candidates: PokemonCardList[] = [];
      const include = (cardList: PokemonCardList) => {
        if (cardList.cards.length === 0) return;
        candidates.push(cardList);
      };
      const collectFor = (p: Player) => {
        if (prompt.slots.includes(SlotType.ACTIVE)) {
          include(p.active);
        }
        if (prompt.slots.includes(SlotType.BENCH)) {
          for (const b of p.bench) include(b);
        }
      };
      if (prompt.playerType === PlayerType.BOTTOM_PLAYER || prompt.playerType === PlayerType.ANY) {
        collectFor(player);
      }
      if (prompt.playerType === PlayerType.TOP_PLAYER || prompt.playerType === PlayerType.ANY) {
        collectFor(opponent);
      }
      const need = Math.max(prompt.options.min, 0);
      if (candidates.length < need) {
        if (prompt.options.allowCancel) {
          return new ResolvePromptAction(prompt.id, null);
        }
        return new ResolvePromptAction(prompt.id, candidates);
      }
      const picked = Env.sampleWithoutReplacement(candidates, need, rng);
      return new ResolvePromptAction(prompt.id, picked);
    }

    // 7. ChoosePrizePrompt — pick `count` prizes (CardList[]).
    if (prompt instanceof ChoosePrizePrompt) {
      const player = state.players.find(p => p.id === prompt.playerId);
      if (player === undefined) {
        return new ResolvePromptAction(prompt.id, null);
      }
      const remaining = player.prizes.filter(p => p.cards.length > 0);
      const need = prompt.options.count;
      if (remaining.length < need) {
        if (prompt.options.allowCancel) {
          return new ResolvePromptAction(prompt.id, null);
        }
        return new ResolvePromptAction(prompt.id, remaining);
      }
      const picked = Env.sampleWithoutReplacement(remaining, need, rng);
      return new ResolvePromptAction(prompt.id, picked);
    }

    // 8. SelectPrompt — pick a numeric option index in [0, values.length).
    if (prompt instanceof SelectPrompt) {
      const n = prompt.values.length;
      const choice = n > 0 ? rng.nextInt(n) : 0;
      return new ResolvePromptAction(prompt.id, choice);
    }

    // 9. OrderCardsPrompt — Phase 1: identity ordering. Sub-optimal but the
    //    deck-search trainer cards in Dragapult mirror typically don't care
    //    about exact order. Plan 01-03 may refine.
    if (prompt instanceof OrderCardsPrompt) {
      const indices: number[] = [];
      for (let i = 0; i < prompt.cards.cards.length; i++) {
        indices.push(i);
      }
      return new ResolvePromptAction(prompt.id, indices);
    }

    // 10. Unknown prompt — log once, fall back to a generic resolution.
    const typeName = prompt.constructor.name;
    if (!observedUnknownPromptTypes.has(typeName)) {
      observedUnknownPromptTypes.add(typeName);
      console.warn(`[env] Unknown prompt type ${typeName}; falling back to null. ` +
        `Add specific handling in src/ai/env.ts and update PROMPT_TYPES.md.`);
    }
    return new ResolvePromptAction(prompt.id, null);
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  protected static cardKey(c: Card): string {
    return c?.fullName ?? '<unknown>';
  }

  /**
   * Sample `n` items from `arr` without replacement using a partial Fisher-Yates
   * shuffle backed by the SeededRNG. Returns a new array of length n.
   */
  protected static sampleWithoutReplacement<T>(arr: T[], n: number, rng: SeededRNG): T[] {
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

  /**
   * Replicate ChooseCardsPrompt.matchesFilter (which is private). Compares each
   * filter key against the card.
   */
  protected static matchesFilter(card: Card, filter: any): boolean {
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
}
