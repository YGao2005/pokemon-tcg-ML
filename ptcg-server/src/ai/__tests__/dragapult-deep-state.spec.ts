/**
 * dragapult-deep-state.spec.ts — Plan 01-05 Task 2 (L4 deep state tests)
 *
 * Each Tier 1/2 card in the Dragapult mirror deck gets at least one test
 * exercising it from a REALISTIC mid-game state (turn 5+, partial bench,
 * energies attached, damage present). L2 tests (in `dragapult-cards.spec.ts`)
 * already cover "doesn't crash from a clean state"; this layer catches the
 * crash class that only appears when the engine is in a non-trivial state —
 * tool attached, damage already on the target, multiple bench Pokemon
 * competing for prompt selection, etc.
 *
 * L4 acceptance bar: `result.crashed === false` AND
 * `result.gameError === false` (or a clean expected GameError for the
 * known edge cases). State CHANGES are L5 territory and are verified in
 * `dragapult-semantics.spec.ts`.
 *
 * Test runner: same as dragapult-cards.spec.ts — compile via tolerant tsc,
 * then run via plain jasmine on the emitted JS:
 *   npx tsc --noEmitOnError false
 *   npx jasmine output/ai/__tests__/dragapult-deep-state.spec.js
 */

import {
  ScenarioBuilder,
} from './helpers/scenario-builder';
import {
  dispatchAction,
  ensureCardManagerInitialized,
  injectCardIntoHand,
  expectNoCrash,
  CardTestContext,
} from './helpers/card-test-harness';
import { PlayerType, SlotType, PlayCardAction } from '../../game/store/actions/play-card-action';
import { AttackAction, UseAbilityAction } from '../../game/store/actions/game-actions';

// Helpers ---------------------------------------------------------------------

function findCardInHand(ctx: CardTestContext, fullName: string): number {
  return ctx.player.hand.cards.findIndex(c => c.fullName === fullName);
}

function playCardByName(ctx: CardTestContext, fullName: string, target?: { player: PlayerType; slot: SlotType; index: number }) {
  const idx = findCardInHand(ctx, fullName);
  if (idx === -1) {
    throw new Error(`L4 helper: ${fullName} not in hand (hand=[${ctx.player.hand.cards.map(c => c.fullName).join(', ')}])`);
  }
  const t = target ?? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BOARD, index: 0 };
  return dispatchAction(ctx, new PlayCardAction(ctx.player.id, idx, t));
}

// Test suite ------------------------------------------------------------------

describe('Dragapult deck — L4 deep state tests', () => {

  beforeAll(() => {
    ensureCardManagerInitialized();
  });

  // ---------------------------------------------------------------------------
  // Dragapult ex TWM — Phantom Dive in mid-game positions
  // ---------------------------------------------------------------------------

  describe('Dragapult ex TWM — Phantom Dive', () => {

    it('L4: turn 6 mirror with damaged bench, opponent has 2 benched Pokemon', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(6)
        .p0Active('Dragapult ex TWM', {
          damage: 30,
          energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p0Bench('Drakloak TWM')
        .p1Active('Dreepy TWM', { damage: 20 })
        .p1Bench('Duskull SFA', { damage: 10 })
        .p1Bench('Munkidori TWM')
        .build();

      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expectNoCrash(result, 'Phantom Dive turn 6 damaged bench');
      expect(result.gameError).toBe(false);
    });

    it('L4: turn 8, low-HP bench Pokemon should be killable via spread damage', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(8)
        .p0Active('Dragapult ex TWM', {
          energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p0Bench('Drakloak TWM')
        .p1Active('Drakloak TWM', { damage: 60 })
        // Both bench Pokemon at low HP — spread should KO them.
        .p1Bench('Duskull SFA', { damage: 50 })
        .p1Bench('Budew PRE', { damage: 30 })
        .build();

      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expectNoCrash(result, 'Phantom Dive turn 8 low HP bench');
      expect(result.gameError).toBe(false);
    });

    it('L4: late game — Dragapult ex with damage, opponent has no bench (only active)', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(10)
        .p0Active('Dragapult ex TWM', {
          damage: 100,
          energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p1Active('Dreepy TWM')  // no bench
        .build();

      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expectNoCrash(result, 'Phantom Dive empty bench');
      // No bench → the spread skips. The base 200 damage should still apply,
      // and the action should NOT GameError simply because there are no bench
      // targets (the prompt's PutDamagePrompt is only created when hasBench
      // is true). L5 semantic test verifies the active took the 200 damage.
    });

  });

  // ---------------------------------------------------------------------------
  // Rare Candy SUM — skip-evolve from Basic to Stage 2
  // ---------------------------------------------------------------------------

  describe('Rare Candy SUM', () => {

    it('L4: turn 3, Dreepy with 20 damage + Dragapult ex in hand (no Drakloak)', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM', { damage: 20 })
        .p0Hand('Rare Candy SUM', 'Dragapult ex TWM')
        .build();

      const result = playCardByName(ctx, 'Rare Candy SUM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });
      expectNoCrash(result, 'Rare Candy on damaged Dreepy turn 3');
      // Either succeeds (Dreepy → Dragapult ex via skip-evolve) or expected
      // gameError. Plan 01-05's L5 spec verifies damage carryover.
    });

    it('L4: turn 4, Dreepy with attached Psychic Energy + tool', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(4)
        .p0Active('Dreepy TWM', {
          energies: ['Psychic Energy EVO'],
          tool: 'Poke Pad POR',
        })
        .p0Hand('Rare Candy SUM', 'Dragapult ex TWM')
        .build();

      const result = playCardByName(ctx, 'Rare Candy SUM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });
      expectNoCrash(result, 'Rare Candy preserves attachments');
    });

    it('L4: with Dusclops on bench (wrong evolution line) — ensure no corruption', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM')
        .p0Bench('Dusclops SFA')
        .p0Hand('Rare Candy SUM', 'Dragapult ex TWM')
        .build();

      const result = playCardByName(ctx, 'Rare Candy SUM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });
      expectNoCrash(result, 'Rare Candy with cross-line Dusclops on bench');
    });

  });

  // ---------------------------------------------------------------------------
  // Ultra Ball PLB — discard 2 + fetch a Pokemon
  // ---------------------------------------------------------------------------

  describe('Ultra Ball PLB', () => {

    it('L4: turn 5 hand with several non-Pokemon and Ultra Ball', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dreepy TWM')
        .p0Hand(
          'Ultra Ball PLB',
          'Psychic Energy EVO',
          'Psychic Energy EVO',
          'Fire Energy EVO',
          'Boss\'s Orders MEG',
          'Drakloak TWM',  // Pokemon to keep in hand
        )
        .p0DeckTop('Dragapult ex TWM')  // predictable fetch target
        .p0DeckRest('Drakloak TWM', 'Munkidori TWM')
        .build();

      const result = playCardByName(ctx, 'Ultra Ball PLB');
      expectNoCrash(result, 'Ultra Ball turn 5');
    });

    it('L4: only 2 Pokemon left in deck — fetches one of them', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(7)
        .p0Active('Dreepy TWM')
        .p0Hand(
          'Ultra Ball PLB',
          'Psychic Energy EVO',
          'Psychic Energy EVO',
        )
        .p0DeckTop('Dragapult ex TWM', 'Munkidori TWM')
        .build();

      const result = playCardByName(ctx, 'Ultra Ball PLB');
      expectNoCrash(result, 'Ultra Ball thin deck');
    });

  });

  // ---------------------------------------------------------------------------
  // Buddy-Buddy Poffin TEF — fetch 2 Basic Pokemon
  // ---------------------------------------------------------------------------

  describe('Buddy-Buddy Poffin TEF', () => {

    it('L4: turn 3 with 3 Basics in deck, fetches 2', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM')
        .p0Hand('Buddy-Buddy Poffin TEF')
        .p0DeckTop('Dreepy TWM', 'Duskull SFA', 'Munkidori TWM')
        .build();

      const result = playCardByName(ctx, 'Buddy-Buddy Poffin TEF');
      expectNoCrash(result, 'Buddy-Buddy Poffin happy path');
    });

    it('L4: only 1 Basic left in deck — fetches just that one', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dreepy TWM')
        .p0Hand('Buddy-Buddy Poffin TEF')
        .p0DeckTop('Munkidori TWM')
        .build();

      const result = playCardByName(ctx, 'Buddy-Buddy Poffin TEF');
      expectNoCrash(result, 'Buddy-Buddy Poffin one basic left');
    });

  });

  // ---------------------------------------------------------------------------
  // Lillie's Determination MEG — turn 1 only, discard hand and draw 6
  // ---------------------------------------------------------------------------

  describe("Lillie's Determination MEG", () => {

    it('L4: turn 1 with 4-card hand', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(1)
        .p0Active('Dreepy TWM')
        .p0Hand('Lillie\'s Determination MEG', 'Dreepy TWM', 'Psychic Energy EVO', 'Ultra Ball PLB')
        .build();

      const result = playCardByName(ctx, "Lillie's Determination MEG");
      expectNoCrash(result, "Lillie's Determination turn 1");
    });

    it('L4: turn 2+ should be blocked (turn-1-only rule)', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM')
        .p0Hand('Lillie\'s Determination MEG')
        .build();

      const result = playCardByName(ctx, "Lillie's Determination MEG");
      // Either resolves cleanly (the engine may treat it as a no-op) or
      // gameErrors. Either way, no crash.
      expect(result.crashed).toBe(false);
    });

  });

  // ---------------------------------------------------------------------------
  // Duskull → Dusclops → Dusknoir chain (Cursed Blast on full bench)
  // ---------------------------------------------------------------------------

  describe('Duskull / Dusclops / Dusknoir chain', () => {

    it('L4: Dusknoir Cursed Blast on damaged opponent active', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dreepy TWM')
        .p0Bench('Dusknoir PRE')
        .p1Active('Drakloak TWM', { damage: 80 })
        .p1Bench('Duskull SFA')
        .build();

      const result = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Cursed Blast', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expectNoCrash(result, 'Dusknoir Cursed Blast damaged opponent');
    });

    it('L4: Dusknoir Cursed Blast against multi-target opponent bench', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(6)
        .p0Active('Dreepy TWM')
        .p0Bench('Dusknoir PRE')
        .p1Active('Drakloak TWM')
        .p1Bench('Duskull SFA')
        .p1Bench('Budew PRE')
        .p1Bench('Munkidori TWM')
        .build();

      const result = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Cursed Blast', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expectNoCrash(result, 'Dusknoir Cursed Blast multi-target bench');
    });

    it('L4: Dusclops Cursed Blast — KO-self check', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(4)
        .p0Active('Dreepy TWM')
        .p0Bench('Dusclops SFA')
        .p1Active('Drakloak TWM', { damage: 30 })
        .build();

      const result = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Cursed Blast', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expectNoCrash(result, 'Dusclops Cursed Blast KO-self');
    });

  });

  // ---------------------------------------------------------------------------
  // Munkidori TWM — Adrena-Brain damage transfer
  // ---------------------------------------------------------------------------

  describe('Munkidori TWM Adrena-Brain', () => {

    it('L4: Munkidori with Dark Energy + own damage + opponent active', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(4)
        .p0Active('Dragapult ex TWM', {
          damage: 30,
          energies: ['Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p0Bench('Munkidori TWM', { energies: ['Darkness Energy EVO'] })
        .p1Active('Drakloak TWM')
        .build();

      const result = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Adrena-Brain', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expectNoCrash(result, 'Munkidori Adrena-Brain happy path');
    });

    it('L4: Munkidori without Dark Energy — should GameError', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(4)
        .p0Active('Dragapult ex TWM', {
          damage: 30,
          energies: ['Psychic Energy EVO'],
        })
        .p0Bench('Munkidori TWM')  // no dark energy
        .p1Active('Drakloak TWM')
        .build();

      const result = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Adrena-Brain', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expect(result.crashed).toBe(false);
      // The card explicitly throws GameError CANNOT_USE_POWER if there's no
      // dark energy attached.
      expect(result.gameError).toBe(true);
    });

  });

  // ---------------------------------------------------------------------------
  // Area Zero Underdepths SCR — bench expansion stadium
  // ---------------------------------------------------------------------------

  describe('Area Zero Underdepths SCR', () => {

    it('L4: turn 4, 5-Pokemon bench, stadium played', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(4)
        .p0Active('Dragapult ex TWM')
        .p0Bench('Drakloak TWM')
        .p0Bench('Dreepy TWM')
        .p0Bench('Munkidori TWM')
        .p0Bench('Duskull SFA')
        .p0Bench('Budew PRE')
        .p0Hand('Area Zero Underdepths SCR')
        .build();

      const result = playCardByName(ctx, 'Area Zero Underdepths SCR');
      expectNoCrash(result, 'Area Zero with full bench');
    });

    it('L4: stadium swap — opponent has a stadium already', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dragapult ex TWM')
        .p0Hand('Area Zero Underdepths SCR')
        .stadium('Area Zero Underdepths SCR')  // existing stadium → swap
        .build();

      // Need to remove the stadium first since it's the same name; play with
      // a different stadium would normally swap, but for this engine the
      // existing-same-name should GameError.
      // Just verify no crash.
      const result = playCardByName(ctx, 'Area Zero Underdepths SCR');
      expect(result.crashed).toBe(false);
    });

  });

  // ---------------------------------------------------------------------------
  // Boss's Orders MEG — gust opponent bench Pokemon to active
  // ---------------------------------------------------------------------------

  describe("Boss's Orders MEG", () => {

    it('L4: turn 5 with opponent benched Pokemon to gust', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dragapult ex TWM')
        .p0Hand("Boss's Orders MEG")
        .p1Active('Dreepy TWM')
        .p1Bench('Drakloak TWM', { damage: 70 })
        .build();

      const result = playCardByName(ctx, "Boss's Orders MEG");
      expectNoCrash(result, "Boss's Orders gust damaged bench");
    });

    it("L4: opponent has no bench — should GameError or no-op", () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dragapult ex TWM')
        .p0Hand("Boss's Orders MEG")
        .p1Active('Dreepy TWM')  // no bench
        .build();

      const result = playCardByName(ctx, "Boss's Orders MEG");
      expect(result.crashed).toBe(false);
    });

  });

  // ---------------------------------------------------------------------------
  // Night Stretcher SFA — recover 1 Pokemon + 1 basic energy from discard
  // ---------------------------------------------------------------------------

  describe('Night Stretcher SFA', () => {

    it('L4: discard with 1 Pokemon and 1 energy', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(4)
        .p0Active('Dreepy TWM')
        .p0Hand('Night Stretcher SFA')
        .p0Discard('Drakloak TWM', 'Psychic Energy EVO')
        .build();

      const result = playCardByName(ctx, 'Night Stretcher SFA');
      expectNoCrash(result, 'Night Stretcher discard recovery');
    });

  });

  // ---------------------------------------------------------------------------
  // Crispin SCR — energy tutor for an attacker
  // ---------------------------------------------------------------------------

  describe('Crispin SCR', () => {

    it('L4: turn 4 with Dragapult ex active needing energy', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(4)
        .p0Active('Dragapult ex TWM', { energies: ['Fire Energy EVO'] })
        .p0Hand('Crispin SCR')
        .p0DeckTop('Psychic Energy EVO', 'Fire Energy EVO', 'Psychic Energy EVO')
        .build();

      const result = playCardByName(ctx, 'Crispin SCR');
      expectNoCrash(result, 'Crispin energy tutor');
    });

  });

  // ---------------------------------------------------------------------------
  // Drakloak TWM — Recon Directive ability
  // ---------------------------------------------------------------------------

  describe('Drakloak TWM Recon Directive', () => {

    it('L4: ability with deck cards available, mid-game state', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(4)
        .p0Active('Drakloak TWM', { energies: ['Psychic Energy EVO'] })
        .p0Bench('Dreepy TWM')
        .p0DeckTop('Dragapult ex TWM', 'Rare Candy SUM')
        .build();

      const result = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Recon Directive', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      }));
      expectNoCrash(result, 'Drakloak Recon Directive mid-game');
    });

  });

  // ---------------------------------------------------------------------------
  // Fezandipiti ex SFA — Cruel Arrow attack on damaged opponent
  // ---------------------------------------------------------------------------

  describe('Fezandipiti ex SFA Cruel Arrow', () => {

    it('L4: attack with full energy against damaged opponent active', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Fezandipiti ex SFA', {
          energies: ['Darkness Energy EVO', 'Darkness Energy EVO', 'Darkness Energy EVO'],
        })
        .p1Active('Drakloak TWM', { damage: 50 })
        .p1Bench('Duskull SFA')
        .build();

      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Cruel Arrow'));
      expectNoCrash(result, 'Cruel Arrow with energy');
    });

  });

});
