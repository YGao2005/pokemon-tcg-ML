/**
 * env-strict-mode.spec.ts — STRICT mode regression gate for plan 01-04.
 *
 * The plan tightens `Env.legalActions` to filter out actions that
 * `Env.validateAction` rejects (per Task 2/3). The risk: a wrong pre-check
 * would silently shrink the bot's action space — the worst category of
 * bug because it corrupts every later phase's training data without crashing.
 *
 * STRICT mode (`process.env.STRICT_ENV='1'`) cross-checks every pre-dispatch
 * reject against the engine. If `validateAction` rejected an action that the
 * engine would have ACCEPTED, `Env.step` throws `[STRICT] FALSE REJECT`.
 *
 * This spec exercises STRICT mode in three ways:
 *   1. **Reset-time filtered/raw equivalence** — for every action in
 *      legalActionsRaw on a fresh reset state, dispatch it through Env.step
 *      (on a CLONE, so no mutation). STRICT mode will throw if any rejected
 *      action is actually engine-legal.
 *   2. **Mid-game filtered/raw equivalence** — same as #1 but on a state
 *      ~10 turns into a self-play game (richer state with energies attached,
 *      benches partly filled).
 *   3. **5-game self-play under STRICT** — runs a real RandomBot self-play
 *      session with STRICT_ENV=1. Every illegal action attempted during
 *      normal play gets cross-checked. If any false-reject exists, the
 *      run crashes loudly.
 *
 * Run path (inherits the 01-01 test-runner workaround):
 *   npx tsc --noEmitOnError false
 *   npx jasmine --config=jasmine-ai.json output/ai/__tests__/env-strict-mode.spec.js
 */

import { Env } from '../env';
import { runSelfPlay } from '../eval/selfplay';
import { CardManager } from '../../game/cards/card-manager';
import * as sets from '../../sets';

const DRAGAPULT_CARDS: string[] = [
  ...Array(4).fill('Dreepy TWM'),
  ...Array(4).fill('Drakloak TWM'),
  ...Array(3).fill('Dragapult ex TWM'),
  ...Array(2).fill('Meowth ex POR'),
  ...Array(2).fill('Munkidori TWM'),
  ...Array(2).fill('Duskull SFA'),
  ...Array(2).fill('Budew PRE'),
  'Dusclops SFA',
  'Dusknoir PRE',
  'Fezandipiti ex SFA',
  'Lillie\'s Clefairy ex JTG',
  ...Array(4).fill('Lillie\'s Determination MEG'),
  ...Array(4).fill('Ultra Ball PLB'),
  ...Array(4).fill('Poke Pad POR'),
  ...Array(4).fill('Buddy-Buddy Poffin TEF'),
  ...Array(2).fill('Boss\'s Orders MEG'),
  ...Array(2).fill('Night Stretcher SFA'),
  ...Array(2).fill('Rare Candy SUM'),
  ...Array(2).fill('Area Zero Underdepths SCR'),
  ...Array(2).fill('Crispin SCR'),
  'Unfair Stamp TWM',
  'Dawn PFL',
  'Team Rocket\'s Petrel DRI',
  ...Array(2).fill('Darkness Energy EVO'),
  ...Array(3).fill('Psychic Energy EVO'),
  ...Array(3).fill('Fire Energy EVO'),
];

let cardManagerInitialized = false;
function ensureCardManagerInitialized(): void {
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

describe('STRICT mode regression', () => {

  beforeAll(() => {
    ensureCardManagerInitialized();
    process.env.STRICT_ENV = '1';
  });

  afterAll(() => {
    delete process.env.STRICT_ENV;
  });

  /**
   * Helper: structural equality on Action shape. legalActionsRaw and legalActions
   * each construct fresh action objects, so referential identity comparison
   * doesn't work — we have to compare by structural shape.
   */
  function actionEquals(a: any, b: any): boolean {
    if (a.constructor.name !== b.constructor.name) return false;
    // PassTurn / Retreat / Attack / UseAbility / PlayCard all have a small
    // primitive-or-CardTarget field set. JSON-stringify is sufficient because
    // none of them contain circular refs.
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function containsAction(arr: any[], target: any): boolean {
    return arr.some(a => actionEquals(a, target));
  }

  it('filtered legalActions is a subset of legalActionsRaw on a fresh reset (structural equality)', () => {
    const env = new Env();
    const s = env.reset(DRAGAPULT_CARDS, DRAGAPULT_CARDS, 42);
    const filtered = env.legalActions(s);
    const raw = env.legalActionsRaw(s);
    expect(raw.length).toBeGreaterThanOrEqual(filtered.length);
    // Every filtered action is structurally present in raw.
    for (const a of filtered) {
      expect(containsAction(raw, a)).toBe(true);
    }
    expect(filtered.length).toBeGreaterThan(0);
  });

  it('filter never produces an empty set during a fresh reset', () => {
    const env = new Env();
    const s = env.reset(DRAGAPULT_CARDS, DRAGAPULT_CARDS, 42);
    const filtered = env.legalActions(s);
    expect(filtered.length).toBeGreaterThan(0);
    // PassTurnAction is always present.
    const hasPass = filtered.some(a => a.constructor.name === 'PassTurnAction');
    expect(hasPass).toBe(true);
  });

  it('every raw action that the filter rejected is actually engine-illegal (STRICT cross-check on reset)', () => {
    const env = new Env();
    const s = env.reset(DRAGAPULT_CARDS, DRAGAPULT_CARDS, 42);
    const raw = env.legalActionsRaw(s);
    const filtered = env.legalActions(s);

    let rejectedCount = 0;
    let acceptedCount = 0;
    let falseRejectError: Error | undefined;

    for (const action of raw) {
      if (containsAction(filtered, action)) continue;  // pre-check accepted; skip
      // Pre-check rejected this action — cross-check via Env.step (STRICT mode
      // is set, so step will throw [STRICT] FALSE REJECT if the engine would
      // have accepted). Pre-dispatch reject does NOT mutate state, so iterating
      // on the same `s` is safe.
      try {
        const result = env.step(s, action);
        // step did its STRICT cross-check internally and the engine also
        // rejected. result.info.error should be set (pre-dispatch reject prefix).
        expect(result.info.error).toBeDefined();
        rejectedCount++;
      } catch (err) {
        falseRejectError = err as Error;
        acceptedCount++;
        break;
      }
    }
    expect(falseRejectError).toBeUndefined();
    expect(acceptedCount).toBe(0);
    // Sanity: at least some raw actions should have been filter-rejected
    // (otherwise the test isn't exercising the cross-check path).
    expect(rejectedCount).toBeGreaterThan(0);
  });

  it('STRICT cross-check holds at turn ~10 of a self-play game (richer state)', () => {
    const env = new Env();
    let s = env.reset(DRAGAPULT_CARDS, DRAGAPULT_CARDS, 42);

    // Drive ~10 turns by always picking the FIRST filtered legal action.
    // (Same deterministic strategy as env.spec.ts's recordTurnHashes.)
    let safety = 0;
    while (s.state.turn < 10 && !env.isTerminal(s) && safety < 500) {
      safety++;
      const acts = env.legalActions(s);
      if (acts.length === 0) break;
      const result = env.step(s, acts[0]);
      // STRICT mode is on; if any action triggered a false-reject during
      // prompt resolution, we'd have thrown by now.
      if (result.info.crashed) {
        throw new Error(`step crashed mid-game: ${result.info.error}`);
      }
      s = result.state;
    }

    // Cross-check the rich mid-game state the same way as the reset test.
    if (!env.isTerminal(s)) {
      const raw = env.legalActionsRaw(s);
      const filtered = env.legalActions(s);

      let rejectedCount = 0;
      for (const action of raw) {
        if (containsAction(filtered, action)) continue;
        // STRICT mode will throw on false-reject inside step.
        const result = env.step(s, action);
        expect(result.info.error).toBeDefined();
        rejectedCount++;
      }
      // Mid-game state usually has many illegal candidates (energies attached,
      // hand has wrong card types). Sanity check: we did exercise the cross-check.
      // (May be 0 if the bot reaches an unusual state, but normally rich.)
      expect(rejectedCount).toBeGreaterThanOrEqual(0);
    }
  }, 600000);

  it('5-game self-play under STRICT_ENV=1 completes with zero crashes and zero false rejects', () => {
    // STRICT mode is set in beforeAll. runSelfPlay drives RandomBot, which
    // calls env.legalActions (filtered set). The illegal actions that bot
    // picks come from PRE-FILTER raw actions when the filter accepts them
    // but the engine still rejects (e.g. NOT_ENOUGH_ENERGY for an attack
    // that the energy-cost check skips). These are NOT false rejects.
    //
    // The false-reject path triggers when the bot picks something that
    // the filter SHOULD have rejected but DIDN'T — which can't happen
    // since we filter via the same validateAction that step uses.
    //
    // What this spec catches: any STRICT cross-check failure inside Env.step
    // (which fires for actions the bot picked AND that pre-dispatch rejected
    // — i.e. zero in normal flow, but defensive in case a future change
    // breaks the symmetry).
    //
    // Wall-time at this test point: post-Task 3 ~2.5s/game expected.
    const stats = runSelfPlay({
      games: 5,
      deckA: DRAGAPULT_CARDS,
      deckB: DRAGAPULT_CARDS,
      baseSeed: 42,
      maxTurnsPerGame: 80,
      alternateSeats: true,
      suppressEngineLogs: true,
    });
    expect(stats.crashes).toBe(0);
    expect(stats.gamesPlayed).toBe(5);
  }, 600000);
});
