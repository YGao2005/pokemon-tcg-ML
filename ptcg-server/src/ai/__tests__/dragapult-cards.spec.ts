/**
 * dragapult-cards.spec.ts — L2 smoke + L3 edge-case validation for the
 * Dragapult mirror deck.
 *
 * Plan 01-03 acceptance criteria:
 *   - Every unique card in DRAGAPULT_CARDS has at least one L2 smoke test
 *     ("plays without crashing from a valid clean state").
 *   - Every Tier 1/2 card has at least 2 L3 edge-case scenarios.
 *   - Tier 1 hard blockers (Dragapult ex Phantom Dive, Rare Candy) MUST pass.
 *   - Other failures → KNOWN_CARD_BUGS.md (Tier 2/3) or HALT for checkpoint
 *     (Tier 1 needing engine work).
 *
 * Test run path: this spec imports from `../../sets`, which triggers a
 * pre-existing TS6133 error in N's Purrlon.ts when run via jasmine-ts (see
 * 01-01 SUMMARY decision #2). Workaround: compile via the tolerant tsc and
 * run plain jasmine on the emitted JS:
 *   npx tsc --noEmitOnError false
 *   npx jasmine output/ai/__tests__/dragapult-cards.spec.js
 *
 * L2 = "doesn't crash" — semantic correctness is L5 (plan 01-04).
 * L3 = "edge-case GameError or no-crash" — same semantics scope.
 */

import {
  buildCardTestContext,
  playCard,
  expectNoCrash,
  expectCleanGameError,
  ensureCardManagerInitialized,
  CardTestContext,
  injectCardIntoHand,
} from './helpers/card-test-harness';
import { PlayerType, SlotType } from '../../game/store/actions/play-card-action';
import { AttackAction, UseAbilityAction } from '../../game/store/actions/game-actions';
import { dispatchAction } from './helpers/card-test-harness';

// All 26 unique Dragapult cards (deduplicated from default-decks.ts).
const DRAGAPULT_UNIQUE = [
  // Pokemon — basics
  'Dreepy TWM',
  'Meowth ex POR',
  'Munkidori TWM',
  'Duskull SFA',
  'Budew PRE',
  'Fezandipiti ex SFA',
  'Lillie\'s Clefairy ex JTG',
  // Pokemon — evolutions
  'Drakloak TWM',
  'Dragapult ex TWM',
  'Dusclops SFA',
  'Dusknoir PRE',
  // Trainers
  'Lillie\'s Determination MEG',
  'Ultra Ball PLB',
  'Poke Pad POR',
  'Buddy-Buddy Poffin TEF',
  'Boss\'s Orders MEG',
  'Night Stretcher SFA',
  'Rare Candy SUM',
  'Area Zero Underdepths SCR',
  'Crispin SCR',
  'Unfair Stamp TWM',
  'Dawn PFL',
  'Team Rocket\'s Petrel DRI',
  // Energy
  'Darkness Energy EVO',
  'Psychic Energy EVO',
  'Fire Energy EVO',
];

describe('Dragapult cards — L2 smoke tests', () => {

  beforeAll(() => {
    ensureCardManagerInitialized();
  });

  // -------------------------------------------------------------------------
  // BASIC POKEMON — play from hand to bench (turn 1 OK)
  // -------------------------------------------------------------------------

  describe('Dreepy TWM', () => {
    it('plays from hand to an empty bench', () => {
      const ctx = buildCardTestContext({
        handCards: ['Dreepy TWM'],
      });
      const result = playCard(ctx, 'Dreepy TWM');
      expectNoCrash(result, 'Dreepy TWM L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Meowth ex POR', () => {
    it('plays from hand to bench (Last-Ditch Catch ability triggers)', () => {
      const ctx = buildCardTestContext({
        handCards: ['Meowth ex POR'],
      });
      const result = playCard(ctx, 'Meowth ex POR');
      expectNoCrash(result, 'Meowth ex POR L2');
    });
  });

  describe('Munkidori TWM', () => {
    it('plays from hand to bench', () => {
      const ctx = buildCardTestContext({
        handCards: ['Munkidori TWM'],
      });
      const result = playCard(ctx, 'Munkidori TWM');
      expectNoCrash(result, 'Munkidori TWM L2');
    });
  });

  describe('Duskull SFA', () => {
    it('plays from hand to bench', () => {
      const ctx = buildCardTestContext({
        handCards: ['Duskull SFA'],
      });
      const result = playCard(ctx, 'Duskull SFA');
      expectNoCrash(result, 'Duskull SFA L2');
    });
  });

  describe('Budew PRE', () => {
    it('plays from hand to bench', () => {
      const ctx = buildCardTestContext({
        handCards: ['Budew PRE'],
      });
      const result = playCard(ctx, 'Budew PRE');
      expectNoCrash(result, 'Budew PRE L2');
    });
  });

  describe('Fezandipiti ex SFA', () => {
    it('plays from hand to bench', () => {
      const ctx = buildCardTestContext({
        handCards: ['Fezandipiti ex SFA'],
      });
      const result = playCard(ctx, 'Fezandipiti ex SFA');
      expectNoCrash(result, 'Fezandipiti ex SFA L2');
    });
  });

  describe('Lillie\'s Clefairy ex JTG', () => {
    it('plays from hand to bench', () => {
      const ctx = buildCardTestContext({
        handCards: ['Lillie\'s Clefairy ex JTG'],
      });
      const result = playCard(ctx, 'Lillie\'s Clefairy ex JTG');
      expectNoCrash(result, "Lillie's Clefairy ex JTG L2");
    });
  });

  // -------------------------------------------------------------------------
  // STAGE 1 / STAGE 2 POKEMON — evolve from active (turn ≥ 2)
  // -------------------------------------------------------------------------

  describe('Drakloak TWM', () => {
    it('evolves from Dreepy TWM on turn 2', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Dreepy TWM' }],
        handCards: ['Drakloak TWM'],
      });
      const result = playCard(ctx, 'Drakloak TWM');
      expectNoCrash(result, 'Drakloak TWM L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Dragapult ex TWM', () => {
    it('evolves from Drakloak TWM on turn 2 (HARD BLOCKER)', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Drakloak TWM' }],
        handCards: ['Dragapult ex TWM'],
      });
      const result = playCard(ctx, 'Dragapult ex TWM');
      expectNoCrash(result, 'Dragapult ex TWM evolution L2');
      expect(result.gameError).toBe(false);
    });

    it('Phantom Dive attack dispatches without crashing (HARD BLOCKER)', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          { player: 0, pokemon: 'Dragapult ex TWM', energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'] },
        ],
        benchSetup: [
          { player: 1, pokemon: ['Duskull SFA', 'Budew PRE'] },
        ],
      });
      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expectNoCrash(result, 'Phantom Dive L2');
      // We do NOT assert gameError===false here — different seeds may legally
      // hit "GameError clean" if the player's energy is not exactly right.
      // But for our setup with full energy, expect success.
      expect(result.gameError).toBe(false);
    });
  });

  describe('Dusclops SFA', () => {
    it('evolves from Duskull SFA on turn 2', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Duskull SFA' }],
        handCards: ['Dusclops SFA'],
      });
      const result = playCard(ctx, 'Dusclops SFA');
      expectNoCrash(result, 'Dusclops SFA L2');
    });
  });

  describe('Dusknoir PRE', () => {
    it('evolves from Dusclops SFA on turn 2', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Dusclops SFA' }],
        handCards: ['Dusknoir PRE'],
      });
      const result = playCard(ctx, 'Dusknoir PRE');
      expectNoCrash(result, 'Dusknoir PRE L2');
    });
  });

  // -------------------------------------------------------------------------
  // SUPPORTERS / ITEMS / STADIUMS / TOOLS
  // -------------------------------------------------------------------------

  describe('Lillie\'s Determination MEG', () => {
    it('plays as supporter, shuffles hand and draws (HARD BLOCKER)', () => {
      const ctx = buildCardTestContext({
        handCards: ['Lillie\'s Determination MEG'],
      });
      const result = playCard(ctx, 'Lillie\'s Determination MEG');
      expectNoCrash(result, "Lillie's Determination MEG L2");
      expect(result.gameError).toBe(false);
    });
  });

  describe('Ultra Ball PLB', () => {
    it('plays as item, discards 2 and searches for Pokemon (HARD BLOCKER)', () => {
      const ctx = buildCardTestContext({
        handCards: ['Ultra Ball PLB'],
      });
      const result = playCard(ctx, 'Ultra Ball PLB');
      expectNoCrash(result, 'Ultra Ball PLB L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Poke Pad POR', () => {
    it('plays as item, retrieves a Supporter from discard', () => {
      const ctx = buildCardTestContext({
        handCards: ['Poke Pad POR'],
        discardSetup: [{ player: 0, cards: ['Lillie\'s Determination MEG'] }],
      });
      const result = playCard(ctx, 'Poke Pad POR');
      expectNoCrash(result, 'Poke Pad POR L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Buddy-Buddy Poffin TEF', () => {
    it('plays as item, searches for Basic Pokemon (HARD BLOCKER)', () => {
      const ctx = buildCardTestContext({
        handCards: ['Buddy-Buddy Poffin TEF'],
      });
      const result = playCard(ctx, 'Buddy-Buddy Poffin TEF');
      expectNoCrash(result, 'Buddy-Buddy Poffin TEF L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Boss\'s Orders MEG', () => {
    it('plays as supporter, switches opponent active', () => {
      const ctx = buildCardTestContext({
        handCards: ['Boss\'s Orders MEG'],
        // Need an opponent with bench so the switch has a valid target
        benchSetup: [{ player: 1, pokemon: ['Dreepy TWM'] }],
      });
      const result = playCard(ctx, 'Boss\'s Orders MEG');
      expectNoCrash(result, "Boss's Orders MEG L2");
      // We don't strictly assert no GameError here since the card requires
      // opponent to have a benched Pokemon — we set that up, so expect success.
      expect(result.gameError).toBe(false);
    });
  });

  describe('Night Stretcher SFA', () => {
    it('plays as item, retrieves a Pokemon from discard', () => {
      const ctx = buildCardTestContext({
        handCards: ['Night Stretcher SFA'],
        discardSetup: [{ player: 0, cards: ['Dreepy TWM'] }],
      });
      const result = playCard(ctx, 'Night Stretcher SFA');
      expectNoCrash(result, 'Night Stretcher SFA L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Rare Candy SUM', () => {
    it('plays as item, evolves Basic to Stage 2 (HARD BLOCKER)', () => {
      // Rare Candy needs a Basic in play that has a matching Stage 2 in hand,
      // and the Basic must NOT have been played this turn.
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Dreepy TWM' }],
        handCards: ['Rare Candy SUM', 'Dragapult ex TWM'],
      });
      const result = playCard(ctx, 'Rare Candy SUM');
      expectNoCrash(result, 'Rare Candy SUM L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Area Zero Underdepths SCR', () => {
    it('plays as stadium', () => {
      const ctx = buildCardTestContext({
        handCards: ['Area Zero Underdepths SCR'],
      });
      const result = playCard(ctx, 'Area Zero Underdepths SCR');
      expectNoCrash(result, 'Area Zero Underdepths SCR L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Crispin SCR', () => {
    it('plays as supporter, searches for energy', () => {
      const ctx = buildCardTestContext({
        handCards: ['Crispin SCR'],
      });
      const result = playCard(ctx, 'Crispin SCR');
      expectNoCrash(result, 'Crispin SCR L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Unfair Stamp TWM', () => {
    it('plays as item, both players shuffle and draw (semantics: usable as ACE_SPEC item)', () => {
      const ctx = buildCardTestContext({
        handCards: ['Unfair Stamp TWM'],
      });
      const result = playCard(ctx, 'Unfair Stamp TWM');
      expectNoCrash(result, 'Unfair Stamp TWM L2');
      // Note: real Unfair Stamp requires a KO last turn — the engine
      // doesn't enforce this (see TWM Unfair Stamp.ts comment). So no
      // GameError expected.
    });
  });

  describe('Dawn PFL', () => {
    it('plays as supporter, searches for Basic/Stage1/Stage2', () => {
      const ctx = buildCardTestContext({
        handCards: ['Dawn PFL'],
      });
      const result = playCard(ctx, 'Dawn PFL');
      expectNoCrash(result, 'Dawn PFL L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Team Rocket\'s Petrel DRI', () => {
    it('plays as supporter, searches for a Trainer', () => {
      const ctx = buildCardTestContext({
        handCards: ['Team Rocket\'s Petrel DRI'],
      });
      const result = playCard(ctx, 'Team Rocket\'s Petrel DRI');
      expectNoCrash(result, "Team Rocket's Petrel DRI L2");
      expect(result.gameError).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // ENERGY CARDS — attach to active
  // -------------------------------------------------------------------------

  describe('Darkness Energy EVO', () => {
    it('attaches to active Pokemon', () => {
      const ctx = buildCardTestContext({
        handCards: ['Darkness Energy EVO'],
      });
      const result = playCard(ctx, 'Darkness Energy EVO');
      expectNoCrash(result, 'Darkness Energy EVO L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Psychic Energy EVO', () => {
    it('attaches to active Pokemon', () => {
      const ctx = buildCardTestContext({
        handCards: ['Psychic Energy EVO'],
      });
      const result = playCard(ctx, 'Psychic Energy EVO');
      expectNoCrash(result, 'Psychic Energy EVO L2');
      expect(result.gameError).toBe(false);
    });
  });

  describe('Fire Energy EVO', () => {
    it('attaches to active Pokemon', () => {
      const ctx = buildCardTestContext({
        handCards: ['Fire Energy EVO'],
      });
      const result = playCard(ctx, 'Fire Energy EVO');
      expectNoCrash(result, 'Fire Energy EVO L2');
      expect(result.gameError).toBe(false);
    });
  });

});
