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
import { PlayCardAction, PlayerType, SlotType, CardTarget } from '../game/store/actions/play-card-action';
import { PassTurnAction, AttackAction, RetreatAction, UseAbilityAction } from '../game/store/actions/game-actions';
import { Prompt } from '../game/store/prompts/prompt';
import { GameError } from '../game/game-error';
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
import { EnergyCard } from '../game/store/card/energy-card';
import { PokemonCard } from '../game/store/card/pokemon-card';
import { TrainerCard } from '../game/store/card/trainer-card';
import { Stage, TrainerType, SpecialCondition } from '../game/store/card/card-types';
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
   * Cheap pre-dispatch validation — mirrors the engine reducers' early-rejection
   * paths so obviously-illegal actions can be rejected without paying for
   * `Store.dispatch`'s deepClone. Used by both `Env.step` (skip dispatch on
   * reject) and `Env.legalActions` (filter the over-enumerated raw set).
   *
   * Returns `{ valid: true }` if the action *might* succeed (but the engine still
   * has the final say — deeper checks like ability-specific preconditions or
   * exact energy cost matching are NOT mirrored here). Returns `{ valid: false,
   * reason }` if the action is obviously illegal from the current state.
   *
   * **Correctness contract:** every check here MUST mirror an early-rejection
   * path in the engine reducers (`src/game/store/reducers/` and
   * `src/game/store/effect-reducers/`). The STRICT mode in `step()` cross-checks
   * each reject by also dispatching the action and asserting the engine
   * rejected too — any false-reject throws a fatal error. **When in doubt,
   * leave the action valid (over-enumerate) rather than risk a silent
   * shrink of the action space.**
   *
   * Engine reducer mappings (verified by reading the source as of 01-04):
   *   PassTurnAction      → reducers/player-turn-reducer.ts NOT_YOUR_TURN check
   *   PlayCardAction      → reducers/play-card-reducer.ts (energy/pokemon/trainer paths)
   *   AttackAction        → player-turn-reducer.ts UNKNOWN_ATTACK + game-effect.ts useAttack status check
   *   RetreatAction       → effect-reducers/retreat-effect.ts retreat checks
   *   UseAbilityAction    → player-turn-reducer.ts UseAbilityAction switch
   */
  public validateAction(state: State, action: Action): { valid: boolean; reason?: string } {
    // Defensive: terminal or unresolved-prompts state — caller is wrong but be safe.
    if (state.phase === GamePhase.FINISHED) {
      return { valid: false, reason: 'game already terminal' };
    }
    if (state.phase !== GamePhase.PLAYER_TURN) {
      // The engine ignores actions in other phases (returns state unchanged); we
      // call those rejects so the bot doesn't waste a dispatch.
      return { valid: false, reason: `not player turn (phase=${state.phase})` };
    }

    const player = state.players[state.activePlayer];
    if (player === undefined) {
      return { valid: false, reason: 'no active player' };
    }

    // -----------------------------------------------------------------------
    // PassTurnAction — always valid for the active player.
    // Engine: player-turn-reducer.ts:20-22 (only NOT_YOUR_TURN rejection).
    // -----------------------------------------------------------------------
    if (action instanceof PassTurnAction) {
      if (player.id !== action.clientId) {
        return { valid: false, reason: 'NOT_YOUR_TURN' };
      }
      return { valid: true };
    }

    // -----------------------------------------------------------------------
    // PlayCardAction
    // Engine: play-card-reducer.ts (lines 36-119)
    // -----------------------------------------------------------------------
    if (action instanceof PlayCardAction) {
      if (player.id !== action.id) {
        return { valid: false, reason: 'NOT_YOUR_TURN' };
      }

      const handCard = player.hand.cards[action.handIndex];
      if (handCard === undefined) {
        return { valid: false, reason: 'UNKNOWN_CARD: handIndex out of range' };
      }

      // Resolve target the same way play-card-reducer.ts findCardList does.
      // BOTTOM_PLAYER → active player, TOP_PLAYER → opponent.
      const targetPlayer = action.target.player === PlayerType.BOTTOM_PLAYER
        ? player
        : state.players[state.activePlayer ? 0 : 1];
      if (targetPlayer === undefined) {
        return { valid: false, reason: 'INVALID_TARGET: target player undefined' };
      }

      let targetCardList: PokemonCardList | undefined;
      if (action.target.slot === SlotType.ACTIVE) {
        targetCardList = targetPlayer.active;
      } else if (action.target.slot === SlotType.BENCH) {
        targetCardList = targetPlayer.bench[action.target.index];
      }
      // For SlotType.BOARD (used by trainers without a specific target),
      // the engine's findCardList returns undefined, which is fine for trainers
      // that don't need a target — leave targetCardList undefined.

      // EnergyCard checks (play-card-reducer.ts:58-66).
      if (handCard instanceof EnergyCard) {
        // Engine requires a non-empty PokemonCardList target.
        if (!(targetCardList instanceof PokemonCardList) || targetCardList.cards.length === 0) {
          return { valid: false, reason: 'INVALID_TARGET: energy needs a Pokemon target' };
        }
        if (player.energyPlayedTurn === state.turn) {
          return { valid: false, reason: 'ENERGY_ALREADY_ATTACHED' };
        }
        return { valid: true };
      }

      // PokemonCard checks (play-card-reducer.ts:72-80 + play-pokemon-effect.ts).
      if (handCard instanceof PokemonCard) {
        if (!(targetCardList instanceof PokemonCardList)) {
          return { valid: false, reason: 'INVALID_TARGET: pokemon needs a PokemonCardList target' };
        }
        // Basic Pokemon must go to an EMPTY slot (play-pokemon-effect.ts:19).
        // Note: the engine treats `target.cards.length === 0` as the basic-play
        // path; non-empty target falls through to the evolution path.
        if (handCard.stage === Stage.BASIC) {
          if (targetCardList.cards.length !== 0) {
            return { valid: false, reason: 'INVALID_TARGET: basic Pokemon must go to an empty slot' };
          }
          return { valid: true };
        }
        // Evolution: target must contain a Pokemon whose name matches evolvesFrom
        // and whose stage is strictly lower (play-pokemon-effect.ts:36).
        const onTarget = targetCardList.getPokemonCard();
        if (onTarget === undefined) {
          return { valid: false, reason: 'INVALID_TARGET: no Pokemon to evolve from' };
        }
        if (onTarget.name !== handCard.evolvesFrom) {
          return { valid: false, reason: `INVALID_TARGET: cannot evolve from ${onTarget.name}` };
        }
        if (onTarget.stage >= handCard.stage) {
          return { valid: false, reason: 'INVALID_TARGET: target Pokemon stage too high' };
        }
        // pokemonPlayedTurn check (play-pokemon-effect.ts:40-42). Note: the
        // engine resolves this via CheckPokemonPlayedTurnEffect which other
        // cards (e.g. Rare Candy) can intercept; we MUST be conservative here
        // and only reject when targetCardList.pokemonPlayedTurn is strictly
        // greater than the current turn (which would be a bug) OR equal (the
        // engine throws POKEMON_CANT_EVOLVE_THIS_TURN). But Rare Candy etc
        // bypass this check, so a strict reject would be a false-reject for
        // those cards. **Conservative: leave the played-turn check OFF.**
        // The engine will reject correctly via POKEMON_CANT_EVOLVE_THIS_TURN
        // if the play is illegal, paying the deepClone cost — that's OK.
        return { valid: true };
      }

      // TrainerCard checks (play-card-reducer.ts:82-118).
      if (handCard instanceof TrainerCard) {
        switch (handCard.trainerType) {
          case TrainerType.SUPPORTER:
            if (state.turn === 1 && !state.rules.firstTurnUseSupporter) {
              return { valid: false, reason: 'CANNOT_PLAY_THIS_CARD: supporter on turn 1' };
            }
            if (player.supporter.cards.length > 0) {
              return { valid: false, reason: 'SUPPORTER_ALREADY_PLAYED' };
            }
            return { valid: true };
          case TrainerType.STADIUM: {
            if (player.stadiumPlayedTurn === state.turn) {
              return { valid: false, reason: 'STADIUM_ALREADY_PLAYED' };
            }
            // Same stadium already in play check (mirroring StateUtils.getStadiumCard).
            for (const p of state.players) {
              if (p.stadium.cards.length > 0 && p.stadium.cards[0].name === handCard.name) {
                return { valid: false, reason: 'SAME_STADIUM_ALREADY_IN_PLAY' };
              }
            }
            return { valid: true };
          }
          case TrainerType.TOOL:
            if (!(targetCardList instanceof PokemonCardList) || targetCardList.cards.length === 0) {
              return { valid: false, reason: 'INVALID_TARGET: tool needs a Pokemon target' };
            }
            return { valid: true };
          default:
            // ITEM and any other trainer type — engine just dispatches PlayItemEffect.
            return { valid: true };
        }
      }

      // Unknown card type — let the engine handle it.
      return { valid: true };
    }

    // -----------------------------------------------------------------------
    // AttackAction
    // Engine: player-turn-reducer.ts:42-62 + game-effect.ts useAttack:46-83
    // -----------------------------------------------------------------------
    if (action instanceof AttackAction) {
      if (player.id !== action.clientId) {
        return { valid: false, reason: 'NOT_YOUR_TURN' };
      }
      const activePokemon = player.active.getPokemonCard();
      if (activePokemon === undefined) {
        return { valid: false, reason: 'UNKNOWN_ATTACK: no active Pokemon' };
      }
      const attack = activePokemon.attacks.find(a => a.name === action.name);
      if (attack === undefined) {
        return { valid: false, reason: 'UNKNOWN_ATTACK: attack not on active' };
      }
      // Status conditions (game-effect.ts:49-52). PARALYZED/ASLEEP block attacks.
      const sp = player.active.specialConditions;
      if (sp.includes(SpecialCondition.PARALYZED) || sp.includes(SpecialCondition.ASLEEP)) {
        return { valid: false, reason: 'BLOCKED_BY_SPECIAL_CONDITION' };
      }
      // Energy cost check (game-effect.ts:55-63). NOT mirrored — would require
      // running CheckAttackCostEffect + CheckProvidedEnergyEffect which are
      // non-trivial and Tool / Special Energy can modify both. The engine will
      // throw NOT_ENOUGH_ENERGY for us if needed; that's a known cost.
      return { valid: true };
    }

    // -----------------------------------------------------------------------
    // RetreatAction
    // Engine: player-turn-reducer.ts:30-40 + retreat-effect.ts:30-83
    // -----------------------------------------------------------------------
    if (action instanceof RetreatAction) {
      if (player.id !== action.clientId) {
        return { valid: false, reason: 'NOT_YOUR_TURN' };
      }
      const benchSlot = player.bench[action.benchIndex];
      if (benchSlot === undefined || benchSlot.cards.length === 0) {
        return { valid: false, reason: 'INVALID_TARGET: bench slot empty' };
      }
      const sp = player.active.specialConditions;
      if (sp.includes(SpecialCondition.PARALYZED) || sp.includes(SpecialCondition.ASLEEP)) {
        return { valid: false, reason: 'BLOCKED_BY_SPECIAL_CONDITION' };
      }
      if (player.retreatedTurn === state.turn) {
        return { valid: false, reason: 'RETREAT_ALREADY_USED' };
      }
      // Energy cost check NOT mirrored — see AttackAction note.
      return { valid: true };
    }

    // -----------------------------------------------------------------------
    // UseAbilityAction
    // Engine: player-turn-reducer.ts:64-122
    // -----------------------------------------------------------------------
    if (action instanceof UseAbilityAction) {
      if (player.id !== action.clientId) {
        return { valid: false, reason: 'NOT_YOUR_TURN' };
      }
      // Resolve target Pokemon. The engine uses StateUtils.getTarget; for our
      // bot purposes the target is always BOTTOM_PLAYER (own Pokemon) since
      // legalActionsRaw never enumerates abilities on the opponent.
      let targetPokemonList: PokemonCardList | undefined;
      if (action.target.slot === SlotType.ACTIVE) {
        targetPokemonList = player.active;
      } else if (action.target.slot === SlotType.BENCH) {
        targetPokemonList = player.bench[action.target.index];
      }
      if (action.target.slot === SlotType.ACTIVE || action.target.slot === SlotType.BENCH) {
        if (targetPokemonList === undefined || targetPokemonList.cards.length === 0) {
          return { valid: false, reason: 'INVALID_TARGET: ability target slot empty' };
        }
        const pokemon = targetPokemonList.getPokemonCard();
        if (pokemon === undefined) {
          return { valid: false, reason: 'INVALID_TARGET: no Pokemon at ability target' };
        }
        const power = pokemon.powers.find(p => p.name === action.name);
        if (power === undefined) {
          return { valid: false, reason: 'UNKNOWN_POWER' };
        }
        if (!power.useWhenInPlay) {
          return { valid: false, reason: 'CANNOT_USE_POWER: useWhenInPlay flag missing' };
        }
        return { valid: true };
      }
      if (action.target.slot === SlotType.HAND) {
        const handCard = player.hand.cards[action.target.index];
        if (!(handCard instanceof PokemonCard)) {
          return { valid: false, reason: 'INVALID_TARGET: hand slot is not a Pokemon' };
        }
        const power = handCard.powers.find(p => p.name === action.name);
        if (power === undefined) {
          return { valid: false, reason: 'UNKNOWN_POWER' };
        }
        if (!power.useFromHand) {
          return { valid: false, reason: 'CANNOT_USE_POWER: useFromHand flag missing' };
        }
        return { valid: true };
      }
      if (action.target.slot === SlotType.DISCARD) {
        const discardCard = player.discard.cards[action.target.index];
        if (!(discardCard instanceof PokemonCard)) {
          return { valid: false, reason: 'INVALID_TARGET: discard slot is not a Pokemon' };
        }
        const power = discardCard.powers.find(p => p.name === action.name);
        if (power === undefined) {
          return { valid: false, reason: 'UNKNOWN_POWER' };
        }
        if (!power.useFromDiscard) {
          return { valid: false, reason: 'CANNOT_USE_POWER: useFromDiscard flag missing' };
        }
        return { valid: true };
      }
      // BOARD slot — abilities don't usually use this. Let the engine decide.
      return { valid: true };
    }

    // Unknown action type — pass through. The engine will handle it.
    return { valid: true };
  }

  /**
   * Apply an action and return the resulting EnvState. Never throws.
   *
   * Behavior on errors:
   *   - Pre-dispatch reject (cheap)  → returns input state unchanged, info.error
   *                                     prefixed with `pre-dispatch reject:`
   *   - GameError (illegal action)   → returns input state unchanged, info.error set
   *   - Other exception (crash)      → returns input state unchanged, info.crashed=true
   *   - Successful dispatch          → auto-resolves any prompts the action created,
   *                                     returns the new state with done/reward computed
   *
   * After successful step(), state.prompts is always empty OR the game is terminal.
   * The caller never sees mid-turn prompt state.
   *
   * STRICT mode: when `process.env.STRICT_ENV === '1'`, every pre-dispatch reject
   * is cross-checked against the engine. If the engine would have ACCEPTED the
   * action we rejected, throw a fatal `[STRICT] FALSE REJECT` — this means
   * `validateAction` is silently shrinking the bot's action space. Run STRICT
   * mode as a regression gate before merging perf changes; never enable it for
   * production self-play (it dispatches AND checks, which is slower than the
   * baseline).
   */
  public step(envState: EnvState, action: Action): StepResult {
    // Defensive: if the input state has unresolved prompts, that's a bug
    // upstream — Env consumers should never see prompts. Refuse the step.
    if (envState.state.prompts.some(p => p.result === undefined)) {
      return {
        state: envState,
        reward: 0,
        done: this.isTerminal(envState),
        info: { error: 'input state has unresolved prompts; not allowed in Env API' }
      };
    }

    // Game already over — refuse to advance.
    if (this.isTerminal(envState)) {
      return {
        state: envState,
        reward: 0,
        done: true,
        info: { error: 'game already terminal' }
      };
    }

    // Pre-dispatch validation: skip the deepClone if the action obviously fails.
    const validation = this.validateAction(envState.state, action);
    if (!validation.valid) {
      // STRICT mode regression check: cross-check the reject against the engine.
      if (process.env.STRICT_ENV === '1') {
        this.strictModeCrossCheck(envState, action, validation.reason ?? 'unknown');
      }
      return {
        state: envState,
        reward: 0,
        done: false,
        info: { error: `pre-dispatch reject: ${validation.reason}` }
      };
    }

    // Try to dispatch. The Store's reduce() backs up state internally before
    // calling reducers and restores it on throw, so the underlying store.state
    // is unchanged on a GameError.
    let crashed = false;
    let errorMsg: string | undefined;
    try {
      envState.store.dispatch(action);
    } catch (err) {
      const isGameError = err instanceof GameError ||
        (err && (err as any).constructor && (err as any).constructor.name === 'GameError');
      errorMsg = err && (err as any).message ? (err as any).message : String(err);
      if (!isGameError) {
        crashed = true;
        // Log non-GameError crashes to stderr regardless of DEBUG. The harness
        // will count these but we want them visible in interactive runs too.
        console.error('[env.step] non-GameError crash:', err);
      }
      // Refresh state pointer (the store may have restored it from backup).
      envState.state = envState.store.state;
      return {
        state: envState,
        reward: 0,
        done: false,
        info: crashed ? { crashed: true, error: errorMsg } : { error: errorMsg }
      };
    }

    // Successful dispatch — refresh state pointer and auto-resolve prompts.
    envState.state = envState.store.state;
    let promptsResolved = 0;
    try {
      promptsResolved = this.resolvePromptsLoop(envState, /* isSetup */ false);
    } catch (err) {
      const isGameError = err instanceof GameError ||
        (err && (err as any).constructor && (err as any).constructor.name === 'GameError');
      const msg = err && (err as any).message ? (err as any).message : String(err);
      if (!isGameError) {
        crashed = true;
        console.error('[env.step] non-GameError crash during prompt resolution:', err);
      }
      // The store may now be in an inconsistent state. Best effort: return what
      // we have and flag the crash. Self-play harness will discard this game.
      envState.state = envState.store.state;
      return {
        state: envState,
        reward: 0,
        done: this.isTerminal(envState),
        info: crashed ? { crashed: true, error: msg, promptsResolved } : { error: msg, promptsResolved }
      };
    }

    envState.state = envState.store.state;

    // Compute reward and done.
    const done = this.isTerminal(envState);
    let reward = 0;
    if (done) {
      const winner = this.winner(envState);
      // Reward is +1 for player-0 winner, -1 for player-1 winner, 0 for draw.
      // Bots can negate as needed for side-relative reward.
      if (winner === null) {
        reward = 0;
      } else {
        reward = winner === 0 ? 1 : -1;
      }
    }

    return {
      state: envState,
      reward,
      done,
      info: { promptsResolved }
    };
  }

  /**
   * Returns the over-enumerated candidate action set without precondition filtering.
   * Use this when you need ground truth (tests, MCTS tree expansion correctness checks,
   * debugging). For performance-sensitive callers (RandomBot, self-play harness),
   * prefer legalActions().
   *
   * Invariant: every action returned by legalActions() is also in legalActionsRaw().
   * Inverse is NOT guaranteed — legalActions() may filter out candidates that
   * legalActionsRaw() includes (when validateAction's pre-checks reject them).
   *
   * Phase 1 returns a coarse set:
   *   - PassTurnAction (always)
   *   - PlayCardAction for each card in active player's hand, with a
   *     reasonable default target (active for energy/evolution, first empty
   *     bench for basic Pokemon, board for trainers)
   *   - AttackAction for each attack on the active Pokemon
   *   - RetreatAction for each non-empty bench slot
   *   - UseAbilityAction for the active Pokemon's abilities (and bench
   *     Pokemon abilities — over-enumerated)
   *
   * The bot/encoder layer in plan 01-02+ will refine this to a true legal
   * action set with proper target enumeration.
   */
  public legalActionsRaw(envState: EnvState): Action[] {
    const state = envState.state;
    const actions: Action[] = [];

    // Defensive: if the game is terminal there are no legal actions.
    if (this.isTerminal(envState)) {
      return actions;
    }

    // Defensive: if the state has unresolved prompts (shouldn't happen since
    // step auto-resolves), return only PassTurn as a safe fallback.
    if (state.prompts.some(p => p.result === undefined)) {
      console.warn('[env.legalActions] state has unresolved prompts; returning PassTurn fallback');
      const pid = state.players[state.activePlayer]?.id ?? PLAYER_A_ID;
      actions.push(new PassTurnAction(pid));
      return actions;
    }

    const player = state.players[state.activePlayer];
    if (player === undefined) {
      return actions;
    }
    const pid = player.id;

    // 1. Always include PassTurnAction.
    actions.push(new PassTurnAction(pid));

    // 2. PlayCardAction for each card in hand. Pick a default target based on
    //    card class (Energy → active, Pokemon basic → first empty bench,
    //    Trainer → board, Pokemon evolution → active).
    for (let i = 0; i < player.hand.cards.length; i++) {
      const card = player.hand.cards[i];
      const target = this.defaultTargetForCard(player, card);
      actions.push(new PlayCardAction(pid, i, target));
    }

    // 3. AttackAction for each attack on the active Pokemon.
    const activePokemon = player.active.getPokemonCard();
    if (activePokemon !== undefined) {
      for (const attack of activePokemon.attacks) {
        actions.push(new AttackAction(pid, attack.name));
      }
      // 4. UseAbilityAction for active Pokemon's abilities.
      for (const power of activePokemon.powers) {
        actions.push(new UseAbilityAction(pid, power.name, {
          player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0
        }));
      }
    }

    // 5. UseAbilityAction for each benched Pokemon's abilities (over-enumerate).
    for (let i = 0; i < player.bench.length; i++) {
      const benchPokemon = player.bench[i].getPokemonCard();
      if (benchPokemon !== undefined) {
        for (const power of benchPokemon.powers) {
          actions.push(new UseAbilityAction(pid, power.name, {
            player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: i
          }));
        }
      }
    }

    // 6. RetreatAction for each non-empty bench slot.
    for (let i = 0; i < player.bench.length; i++) {
      if (player.bench[i].cards.length > 0) {
        actions.push(new RetreatAction(pid, i));
      }
    }

    return actions;
  }

  /**
   * Enumerate the filtered legal action set used by performance-sensitive callers.
   *
   * Calls `legalActionsRaw` to get the over-enumerated candidate set, then filters
   * out actions that fail cheap pre-dispatch validation in `validateAction`. This is
   * the same logic `Env.step` uses to short-circuit illegal actions before paying
   * for `Store.dispatch`'s deepClone, so applying it at enumeration time too means
   * RandomBot picks fewer illegal candidates.
   *
   * The filter preserves the order of `legalActionsRaw` so the seeded reproducibility
   * contract holds: same seed → same filtered candidates (in the same order) → same
   * `nextInt(actions.length)` picks. **Note:** the hash sequence emitted by the
   * pre-filter version of `Env.legalActions` will differ from the post-filter version
   * because filtering changes which index nextInt selects. That's expected — what
   * matters is that two runs of THIS code with the same seed produce identical hash
   * sequences (the differential reproducibility invariant).
   *
   * Safety net: if the filtered set is ever empty (which would be a bug — at minimum
   * PassTurnAction is always pre-dispatch valid during a player's turn), fall back to
   * the raw set so RandomBot doesn't crash.
   *
   * Task 1 of plan 01-04: this method initially just calls legalActionsRaw with no
   * filtering — Task 3 will add the filter via validateAction.
   */
  public legalActions(envState: EnvState): Action[] {
    const raw = this.legalActionsRaw(envState);
    const filtered: Action[] = [];
    for (const action of raw) {
      // Preserve raw order: filter is stable so the seeded reproducibility
      // contract holds (same seed → same filtered candidates → same picks).
      if (this.validateAction(envState.state, action).valid) {
        filtered.push(action);
      }
    }
    if (filtered.length === 0) {
      // Should never happen — at minimum PassTurnAction is always pre-dispatch
      // valid during a player's turn. Fall back to raw so RandomBot doesn't
      // crash, and log a warning so the regression is visible.
      console.error('[env.legalActions] WARNING: filtered set is empty, falling back to raw set');
      return raw;
    }
    return filtered;
  }

  /**
   * STRICT mode helper: dispatch the action through a CLONED store and verify
   * it's rejected. Throws `[STRICT] FALSE REJECT` if the engine would have
   * accepted an action that `validateAction` rejected (= silent action-space
   * shrink, the worst possible bug for downstream training data).
   *
   * Only called when `process.env.STRICT_ENV === '1'`. Performance is irrelevant
   * here — STRICT mode is purely a developer-facing correctness gate.
   */
  protected strictModeCrossCheck(envState: EnvState, action: Action, reason: string): void {
    // Build a fully-independent clone of the env state — fresh Store, deep-cloned
    // State, forked RNG. We MUST clone the store too, otherwise dispatching the
    // action would mutate the real state. The existing `clone()` method does
    // exactly this.
    let cloneEnv: EnvState;
    try {
      cloneEnv = this.clone(envState);
    } catch (err) {
      // Clone failed (e.g. unresolved prompts). STRICT cannot verify; let the
      // pre-dispatch reject stand.
      return;
    }
    let engineRejected = false;
    try {
      cloneEnv.store.dispatch(action);
    } catch (err) {
      const isGameError = err instanceof GameError ||
        (err && (err as any).constructor && (err as any).constructor.name === 'GameError');
      if (isGameError) {
        engineRejected = true;
      } else {
        // Engine crashed (non-GameError). Treat as rejected — we don't want
        // STRICT mode to mask crashes as false rejects.
        engineRejected = true;
      }
    }
    if (!engineRejected) {
      throw new Error(
        `[STRICT] FALSE REJECT: Env.validateAction rejected ` +
        `${(action as any).constructor?.name ?? typeof action} with reason ` +
        `"${reason}", but the engine ACCEPTED it. This means legalActions() is ` +
        `silently shrinking the action space. Action: ${JSON.stringify(action)}`
      );
    }
  }

  /**
   * Pick a default CardTarget for a card based on its type. This is best-effort;
   * step() will tolerate INVALID_TARGET via the GameError catch.
   */
  private defaultTargetForCard(player: Player, card: Card): CardTarget {
    // SuperType: 1 = POKEMON, 2 = TRAINER, 3 = ENERGY (per card-types.ts).
    if (card === undefined) {
      return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    }
    if (card.superType === 3) {
      // Energy → active by default.
      return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    }
    if (card.superType === 1) {
      // Pokemon — try first empty bench (good for basics); fall back to active
      // (good for evolutions). step() will return an error on invalid target;
      // the bot can re-pick.
      const emptyIdx = player.bench.findIndex(b => b.cards.length === 0);
      if (emptyIdx !== -1) {
        return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: emptyIdx };
      }
      return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    }
    // Trainer.
    return { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BOARD, index: 0 };
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
