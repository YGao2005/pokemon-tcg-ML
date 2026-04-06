/**
 * RandomBot — uniform-random action selection over Env.legalActions().
 *
 * The bot is fully deterministic given a SeededRNG: two RandomBots constructed
 * with identically-seeded RNGs and shown the same legalActions sequence will
 * pick identical actions in identical order. This is the foundation for the
 * reproducible self-play harness in src/ai/eval/selfplay.ts.
 *
 * Why a class (not just a function): so that the harness can hold one bot per
 * seat across many turns, and so that future PolicyBot/MCTSBot can implement
 * the same `act(env, state)` interface for drop-in replacement.
 *
 * Citation: ByteDance Hearthstone paper (arXiv:2303.05197) §VII.A uses a
 * similar scripted random bot as a stress-test bot before training begins.
 */

import { Env, EnvState } from '../env';
import { Action } from '../../game/store/actions/action';
import { SeededRNG } from '../seeded-rng';

export class RandomBot {

  // The RNG controls action selection. NOT shared with the Env's RNG —
  // selfplay creates a separate fork per bot per game so a bot's choices and
  // the engine's coin flips/shuffles can be independently audited.
  constructor(private readonly rng: SeededRNG) {}

  /**
   * Pick a uniformly-random action from env.legalActions(envState).
   *
   * Throws if legalActions returns an empty list. Env guarantees at least
   * PassTurnAction at every non-terminal state, so an empty list signals
   * either (a) the game is terminal — caller should have checked first, or
   * (b) an Env regression. Either way, escalate as an error rather than
   * silently returning a no-op.
   */
  public act(env: Env, envState: EnvState): Action {
    const actions = env.legalActions(envState);
    if (actions.length === 0) {
      throw new Error(
        'RandomBot.act: env.legalActions returned empty. Either the game is ' +
        'terminal (caller should have checked) or this is an Env regression.'
      );
    }
    const idx = this.rng.nextInt(actions.length);
    return actions[idx];
  }
}
