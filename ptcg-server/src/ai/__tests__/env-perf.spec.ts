/**
 * env-perf.spec.ts — Performance regression gate for plan 01-04.
 *
 * Plan 01-04 measured a baseline of ~30,058 ms/game and an after of ~6,390 ms/game
 * on the same seed (4.7x speedup). The combined effect of:
 *   - Task 2: pre-dispatch validation in Env.step (skips deepClone on obvious illegals)
 *   - Task 3: tighter Env.legalActions filtering (RandomBot picks fewer illegals)
 *   - Task 4: deepClone refMap O(N²) → O(1) Map fix in src/utils/utils.ts
 *
 * This spec is the regression gate. If a future plan accidentally re-introduces the
 * O(N²) clone OR removes the filter OR breaks the validateAction contract, this spec
 * fails immediately. The thresholds are intentionally generous (1.5x slack vs measured)
 * so that machine variance doesn't false-fail.
 *
 * NOTE: thresholds are in ms-per-game, not absolute. Different machines will see
 * different absolutes; what matters is that the perf is within ballpark of "fast
 * enough to make Phase 1 final validation tractable in a single session."
 *
 * Run path (inherits the 01-01 test-runner workaround):
 *   npx tsc --noEmitOnError false
 *   npx jasmine --config=jasmine-ai.json output/ai/__tests__/env-perf.spec.js
 */

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

describe('Env performance regression (plan 01-04 gate)', () => {
  beforeAll(() => {
    ensureCardManagerInitialized();
  });

  it('5 games complete in <60s wall time (12s/game ceiling, 2x slack vs measured 6.4s/game)', () => {
    const start = Date.now();
    const stats = runSelfPlay({
      games: 5,
      deckA: DRAGAPULT_CARDS,
      deckB: DRAGAPULT_CARDS,
      baseSeed: 42,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(60000);
    expect(stats.crashes).toBe(0);
    expect(stats.gamesPlayed).toBe(5);
  }, 120000);

  it('illegal action rate per game is below 250 (1.4x slack vs measured ~181)', () => {
    const stats = runSelfPlay({
      games: 5,
      deckA: DRAGAPULT_CARDS,
      deckB: DRAGAPULT_CARDS,
      baseSeed: 42,
    });
    const illegalPerGame = stats.gameErrors / stats.gamesPlayed;
    expect(illegalPerGame).toBeLessThan(250);
  }, 120000);

  it('zero non-GameError crashes across a 10-game seeded run', () => {
    const stats = runSelfPlay({
      games: 10,
      deckA: DRAGAPULT_CARDS,
      deckB: DRAGAPULT_CARDS,
      baseSeed: 42,
    });
    expect(stats.crashes).toBe(0);
    expect(stats.gamesPlayed).toBe(10);
  }, 180000);
});
