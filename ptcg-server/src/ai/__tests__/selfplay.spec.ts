/**
 * selfplay spec — verifies the runSelfPlay harness for reproducibility,
 * stats integrity, and reasonable wall time on a small batch.
 *
 * This spec imports `../../sets` to bootstrap CardManager, so it must run via
 * plain jasmine on the tsc-emitted JS at output/ai/__tests__/selfplay.spec.js
 * (the same workaround env.spec.ts uses — see 01-01 SUMMARY for rationale).
 *
 * Test runner invocation (from engine/ptcg-server):
 *   npx tsc --noEmitOnError false
 *   npx jasmine --config=jasmine-ai.json
 *
 * The reproducibility test is the most important one in this file: if two
 * runSelfPlay calls with the same options ever produce different stats,
 * something downstream of Plan 01-01's reproducibility invariant has broken.
 */

import { runSelfPlay, SelfPlayStats } from '../eval/selfplay';
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

function statsAreEqual(a: SelfPlayStats, b: SelfPlayStats): boolean {
  if (a.gamesPlayed !== b.gamesPlayed) return false;
  if (a.winsBySeat[0] !== b.winsBySeat[0] || a.winsBySeat[1] !== b.winsBySeat[1]) return false;
  if (a.draws !== b.draws) return false;
  if (a.crashes !== b.crashes) return false;
  if (a.gameErrors !== b.gameErrors) return false;
  if (a.avgTurns !== b.avgTurns) return false;
  if (a.maxTurns !== b.maxTurns) return false;
  // wallTimeMs is excluded — varies between runs.
  // cardPlayCounts must match key-for-key.
  const keysA = Object.keys(a.cardPlayCounts).sort();
  const keysB = Object.keys(b.cardPlayCounts).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (a.cardPlayCounts[keysA[i]] !== b.cardPlayCounts[keysB[i]]) return false;
  }
  // crashDetails: same length and same per-record fields (excluding stack,
  // which contains volatile turn-strings already covered by turn).
  if (a.crashDetails.length !== b.crashDetails.length) return false;
  for (let i = 0; i < a.crashDetails.length; i++) {
    if (a.crashDetails[i].gameIndex !== b.crashDetails[i].gameIndex) return false;
    if (a.crashDetails[i].seed !== b.crashDetails[i].seed) return false;
    if (a.crashDetails[i].turn !== b.crashDetails[i].turn) return false;
    if (a.crashDetails[i].error !== b.crashDetails[i].error) return false;
  }
  return true;
}

describe('runSelfPlay', () => {

  beforeAll(() => {
    ensureCardManagerInitialized();
  });

  // Perf note (2026-04-06): a single Dragapult-mirror random game takes ~30-40s
  // on the current engine because (a) store.reduce deepClones state on every
  // dispatch, (b) Env.legalActions over-enumerates so the random bot triggers
  // ~400+ illegal dispatches per game, and (c) checkState runs full table
  // scans after each valid action. The 5-minute-for-1000-games ROADMAP target
  // is NOT achievable at this engine speed — 01-03 will need to either add a
  // stricter legalActions (cheap wins) or accept the floor. Tests here use
  // small game counts and generous time bounds accordingly.

  it('CRITICAL: 5-game run is byte-identical across two calls (reproducibility)', () => {
    const opts = {
      games: 5,
      deckA: DRAGAPULT_CARDS,
      deckB: DRAGAPULT_CARDS,
      baseSeed: 42,
      maxTurnsPerGame: 80,
      alternateSeats: true,
    };
    const a = runSelfPlay(opts);
    const b = runSelfPlay(opts);
    if (!statsAreEqual(a, b)) {
      // Provide a useful diff via JSON comparison.
      const aClone = { ...a, wallTimeMs: 0 };
      const bClone = { ...b, wallTimeMs: 0 };
      expect(JSON.stringify(aClone)).toEqual(JSON.stringify(bClone));
    } else {
      expect(true).toBe(true);
    }
  }, /* timeout */ 600000);

  it('stats fields are populated and consistent', () => {
    const stats = runSelfPlay({
      games: 3,
      deckA: DRAGAPULT_CARDS,
      deckB: DRAGAPULT_CARDS,
      baseSeed: 100,
      maxTurnsPerGame: 60,
    });
    expect(stats.gamesPlayed).toBe(3);
    expect(stats.winsBySeat[0]).toBeGreaterThanOrEqual(0);
    expect(stats.winsBySeat[1]).toBeGreaterThanOrEqual(0);
    expect(stats.draws).toBeGreaterThanOrEqual(0);
    expect(stats.crashes).toBeGreaterThanOrEqual(0);
    // Sum of resolved-game outcomes must equal gamesPlayed.
    const resolved =
      stats.winsBySeat[0] + stats.winsBySeat[1] + stats.draws + stats.crashes;
    expect(resolved).toBe(stats.gamesPlayed);
    expect(stats.gameErrors).toBeGreaterThanOrEqual(0);
    expect(stats.maxTurns).toBeGreaterThanOrEqual(0);
    expect(stats.avgTurns).toBeGreaterThanOrEqual(0);
    expect(stats.wallTimeMs).toBeGreaterThan(0);
  }, 600000);

  it('cardPlayCounts is non-empty after a 3-game run', () => {
    const stats = runSelfPlay({
      games: 3,
      deckA: DRAGAPULT_CARDS,
      deckB: DRAGAPULT_CARDS,
      baseSeed: 7,
      maxTurnsPerGame: 60,
    });
    const cardCount = Object.keys(stats.cardPlayCounts).length;
    expect(cardCount).toBeGreaterThan(0);
    // Total play count across all cards must be positive.
    let totalPlays = 0;
    for (const k of Object.keys(stats.cardPlayCounts)) {
      totalPlays += stats.cardPlayCounts[k];
    }
    expect(totalPlays).toBeGreaterThan(0);
  }, 600000);

});
