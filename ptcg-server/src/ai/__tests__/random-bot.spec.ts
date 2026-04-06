/**
 * RandomBot spec — verifies deterministic uniform sampling over legalActions.
 *
 * This spec deliberately AVOIDS importing from `../../sets` so it can be run
 * directly via jasmine-ts without the tsc-output workaround that env.spec.ts
 * needs (see 01-01 SUMMARY for the rationale). Env is mocked here; the
 * end-to-end Env+RandomBot integration is covered by selfplay.spec.ts.
 */

import { RandomBot } from '../bots/random';
import { SeededRNG } from '../seeded-rng';
import { Action } from '../../game/store/actions/action';
import { PassTurnAction } from '../../game/store/actions/game-actions';
import { Env, EnvState } from '../env';

// Build N distinct sentinel actions (PassTurnAction with different ids works
// because the RandomBot only cares about array indices, not action semantics).
function makeActions(n: number): Action[] {
  const out: Action[] = [];
  for (let i = 0; i < n; i++) {
    out.push(new PassTurnAction(1000 + i));
  }
  return out;
}

// Minimal Env mock that returns a fixed action list. We cast to Env via
// `unknown` to avoid implementing the full surface.
class MockEnv {
  constructor(private actions: Action[]) {}
  public legalActions(_state: EnvState): Action[] {
    return this.actions.slice();
  }
}

function asEnv(mock: MockEnv): Env {
  return mock as unknown as Env;
}

const FAKE_STATE = {} as EnvState;

describe('RandomBot', () => {

  it('two bots with the same seed pick identical actions over 50 steps', () => {
    const rng1 = new SeededRNG(42);
    const rng2 = new SeededRNG(42);
    const bot1 = new RandomBot(rng1);
    const bot2 = new RandomBot(rng2);
    const env = asEnv(new MockEnv(makeActions(7)));

    for (let i = 0; i < 50; i++) {
      const a1 = bot1.act(env, FAKE_STATE) as PassTurnAction;
      const a2 = bot2.act(env, FAKE_STATE) as PassTurnAction;
      expect(a1.clientId).toBe(a2.clientId);
    }
  });

  it('different seeds diverge within 10 steps', () => {
    const bot1 = new RandomBot(new SeededRNG(42));
    const bot2 = new RandomBot(new SeededRNG(43));
    const env = asEnv(new MockEnv(makeActions(8)));

    let diverged = false;
    for (let i = 0; i < 10; i++) {
      const a1 = bot1.act(env, FAKE_STATE) as PassTurnAction;
      const a2 = bot2.act(env, FAKE_STATE) as PassTurnAction;
      if (a1.clientId !== a2.clientId) {
        diverged = true;
        break;
      }
    }
    expect(diverged).toBe(true);
  });

  it('throws when legalActions is empty', () => {
    const bot = new RandomBot(new SeededRNG(1));
    const env = asEnv(new MockEnv([]));
    expect(() => bot.act(env, FAKE_STATE)).toThrowError(/empty/);
  });

  it('uniform sampling visits every action when sample size is large', () => {
    const N = 5;
    const bot = new RandomBot(new SeededRNG(7));
    const env = asEnv(new MockEnv(makeActions(N)));
    const counts = new Array(N).fill(0);
    for (let i = 0; i < 1000; i++) {
      const a = bot.act(env, FAKE_STATE) as PassTurnAction;
      const idx = a.clientId - 1000;
      counts[idx]++;
    }
    // Each index should be hit at least once across 1000 trials over 5 actions.
    counts.forEach(c => expect(c).toBeGreaterThan(0));
  });

  it('action index falls within [0, legalActions.length) for varying sizes', () => {
    const bot = new RandomBot(new SeededRNG(99));
    for (const n of [1, 2, 3, 17, 50]) {
      const env = asEnv(new MockEnv(makeActions(n)));
      for (let i = 0; i < 100; i++) {
        const a = bot.act(env, FAKE_STATE) as PassTurnAction;
        const idx = a.clientId - 1000;
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(n);
      }
    }
  });

});
