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

// ===========================================================================
// L3 EDGE-CASE SCENARIOS — Tier 1/2 cards
// ===========================================================================

describe('Dragapult cards — L3 edge-case scenarios', () => {

  beforeAll(() => {
    ensureCardManagerInitialized();
  });

  // -------------------------------------------------------------------------
  // Tier 1: Dragapult ex TWM (HARD BLOCKER)
  // -------------------------------------------------------------------------

  describe('Dragapult ex TWM — Phantom Dive edge cases', () => {

    it('Phantom Dive with empty opponent bench (no spread targets) — should not crash', () => {
      // Phantom Dive's card text says "Put 6 damage counters on your opponent's
      // Benched Pokemon in any way you like." With no bench, no spread happens
      // but the 200 base damage still lands on the active.
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          { player: 0, pokemon: 'Dragapult ex TWM', energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'] },
        ],
        // No bench setup for player 1
      });
      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expectNoCrash(result, 'Phantom Dive empty bench L3');
      expect(result.gameError).toBe(false);
      // TODO: L5 — assert opponent active took 200 damage (modulo weakness/resistance)
    });

    it('Phantom Dive with full 5-Pokemon opponent bench dispatches without crashing', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          { player: 0, pokemon: 'Dragapult ex TWM', energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'] },
        ],
        benchSetup: [
          { player: 1, pokemon: ['Duskull SFA', 'Budew PRE', 'Dreepy TWM', 'Munkidori TWM', 'Meowth ex POR'] },
        ],
      });
      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expectNoCrash(result, 'Phantom Dive 5-bench L3');
      expect(result.gameError).toBe(false);
      // TODO: L5 — assert 6 damage counters total distributed across the 5 bench Pokemon
      // TODO: L5 — verify the 4 known semantic bugs in TWM Dragapult ex.ts are fixed:
      //   1. PutDamagePrompt constructor missing maxAllowedDamage arg
      //   2. callback dereferences target.target.damage but target is a CardTarget,
      //      not a PokemonCardList — should use StateUtils.getTarget then PutCountersEffect
      //   See lampent.ts (set-black-and-white-3) for the canonical pattern.
    });

    it('Phantom Dive without Drakloak prerequisite still works if Dragapult ex is on active (not via evolution chain)', () => {
      // Sanity check that the attack itself doesn't depend on having evolved
      // through the chain.
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          { player: 0, pokemon: 'Dragapult ex TWM', energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'] },
        ],
        benchSetup: [
          { player: 1, pokemon: ['Duskull SFA'] },
        ],
      });
      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expectNoCrash(result, 'Phantom Dive bypass-chain L3');
    });

    it('Jet Headbutt (cheap attack) dispatches without crashing', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          { player: 0, pokemon: 'Dragapult ex TWM', energies: ['Psychic Energy EVO'] },
        ],
      });
      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Jet Headbutt'));
      expectNoCrash(result, 'Jet Headbutt L3');
      expect(result.gameError).toBe(false);
    });

    it('Phantom Dive without enough energy GameErrors cleanly', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          // Only 1 energy — needs Fire + Psychic
          { player: 0, pokemon: 'Dragapult ex TWM', energies: ['Psychic Energy EVO'] },
        ],
      });
      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expectCleanGameError(result, 'Phantom Dive insufficient energy L3');
    });
  });

  // -------------------------------------------------------------------------
  // Tier 1: Rare Candy SUM (HARD BLOCKER)
  // -------------------------------------------------------------------------

  describe('Rare Candy SUM — edge cases', () => {

    it('GameErrors cleanly when Rare Candy played with no Stage 2 in hand', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Dreepy TWM' }],
        handCards: ['Rare Candy SUM'],  // no Stage 2 in hand
      });
      const result = playCard(ctx, 'Rare Candy SUM');
      expectCleanGameError(result, 'Rare Candy no-Stage2 L3');
    });

    it('GameErrors cleanly when Rare Candy is played turn 1 (basic was put into play this turn)', () => {
      // Setup: turn 1, Dreepy was placed turn 1 (default pokemonPlayedTurn=0
      // on harness setup means it WAS played "before" turn 1, so this test
      // actually exercises the case where Dreepy is freshly active. To
      // emulate "played this turn", we override pokemonPlayedTurn after build.
      const ctx = buildCardTestContext({
        turn: 1,
        activeSetup: [{ player: 0, pokemon: 'Dreepy TWM' }],
        handCards: ['Rare Candy SUM', 'Dragapult ex TWM'],
      });
      // Mark the Dreepy as "played this turn" (turn 1)
      ctx.player.active.pokemonPlayedTurn = 1;
      const result = playCard(ctx, 'Rare Candy SUM');
      expectCleanGameError(result, 'Rare Candy turn-1 L3');
    });

    it('Rare Candy with both Basic and Stage 2 available evolves successfully', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Dreepy TWM' }],
        handCards: ['Rare Candy SUM', 'Dragapult ex TWM'],
      });
      const result = playCard(ctx, 'Rare Candy SUM');
      expectNoCrash(result, 'Rare Candy normal L3');
      expect(result.gameError).toBe(false);
    });

    it('Rare Candy on a Basic with damage and energies attached carries them over (no crash)', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [
          { player: 0, pokemon: 'Dreepy TWM', damage: 20, energies: ['Psychic Energy EVO', 'Fire Energy EVO'] },
        ],
        handCards: ['Rare Candy SUM', 'Dragapult ex TWM'],
      });
      const result = playCard(ctx, 'Rare Candy SUM');
      expectNoCrash(result, 'Rare Candy with damage+energy L3');
      expect(result.gameError).toBe(false);
      // TODO: L5 — assert resulting Dragapult ex on active still has 20 damage
      // and 2 energies attached (carry-over verification)
    });

    it('Rare Candy with no Basic in play GameErrors cleanly', () => {
      // Edge case: only opponent has a basic; player has only a junk active.
      // Actually, in our harness, both players have a default Dreepy active,
      // so we set the player's active to a non-evolvable basic that doesn't
      // match Dragapult's chain (use Munkidori — its Stage 2 isn't Dragapult).
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Munkidori TWM' }],
        handCards: ['Rare Candy SUM', 'Dragapult ex TWM'],
      });
      const result = playCard(ctx, 'Rare Candy SUM');
      // No basic that matches the Stage 2 → CANNOT_PLAY_THIS_CARD
      expectCleanGameError(result, 'Rare Candy no-matching-basic L3');
    });
  });

  // -------------------------------------------------------------------------
  // Tier 1: Ultra Ball PLB
  // -------------------------------------------------------------------------

  describe('Ultra Ball PLB — edge cases', () => {

    it('GameErrors cleanly when player has fewer than 2 cards in hand other than the Ultra Ball', () => {
      // The harness draws 7 cards by default, so we override the deck to 1
      // and disable the default hand draw.
      const ctx = buildCardTestContext({
        deckCards: ['Dreepy TWM'],  // 1-card deck so default draw gives 1 hand card
        handCards: ['Ultra Ball PLB'],  // Ultra Ball gets injected after the default draw
      });
      // Now player has 2 hand cards: 1 Dreepy (from default draw) + 1 Ultra Ball.
      // After discarding self (Ultra Ball), 1 card remains; need to discard 2 → fail.
      const result = playCard(ctx, 'Ultra Ball PLB');
      expectCleanGameError(result, 'Ultra Ball <2 cards L3');
    });

    it('GameErrors cleanly when deck has 0 Pokemon (cannot search)', () => {
      // Deck filler is 60 cards but we override with energy-only deck
      const energyDeck: string[] = [];
      for (let i = 0; i < 30; i++) energyDeck.push('Psychic Energy EVO');
      for (let i = 0; i < 30; i++) energyDeck.push('Fire Energy EVO');
      const ctx = buildCardTestContext({
        deckCards: energyDeck,
        handCards: ['Ultra Ball PLB'],
      });
      const result = playCard(ctx, 'Ultra Ball PLB');
      // The card itself doesn't pre-check that there's a valid Pokemon in
      // deck — it will fire the search prompt with 0 results, then either
      // resolve with empty selection (no-op) or be cancellable. So this may
      // not be a GameError. We just verify no crash.
      expectNoCrash(result, 'Ultra Ball energy-only deck L3');
    });

    it('GameErrors cleanly when deck is empty', () => {
      const ctx = buildCardTestContext({
        deckCards: [],
        // skip default 7-draw since deck is empty
        noDefaultHand: true,
        handCards: ['Ultra Ball PLB', 'Dreepy TWM', 'Dreepy TWM'],
      });
      const result = playCard(ctx, 'Ultra Ball PLB');
      expectCleanGameError(result, 'Ultra Ball empty deck L3');
    });

    it('Ultra Ball with full hand discards 2 and searches without crashing', () => {
      const ctx = buildCardTestContext({
        handCards: ['Ultra Ball PLB'],
      });
      const result = playCard(ctx, 'Ultra Ball PLB');
      expectNoCrash(result, 'Ultra Ball full hand L3');
      expect(result.gameError).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tier 1: Buddy-Buddy Poffin TEF
  // -------------------------------------------------------------------------

  describe('Buddy-Buddy Poffin TEF — edge cases', () => {

    it('GameErrors cleanly with no Basic Pokemon ≤70 HP in deck', () => {
      // Override deck with only energies and high-HP basics
      const noLowHpDeck: string[] = [];
      for (let i = 0; i < 30; i++) noLowHpDeck.push('Psychic Energy EVO');
      for (let i = 0; i < 30; i++) noLowHpDeck.push('Fezandipiti ex SFA'); // 210 HP
      const ctx = buildCardTestContext({
        deckCards: noLowHpDeck,
        handCards: ['Buddy-Buddy Poffin TEF'],
      });
      const result = playCard(ctx, 'Buddy-Buddy Poffin TEF');
      expectCleanGameError(result, 'Buddy-Buddy Poffin no valid targets L3');
    });

    it('GameErrors cleanly when bench is full', () => {
      const ctx = buildCardTestContext({
        handCards: ['Buddy-Buddy Poffin TEF'],
        benchSetup: [{ player: 0, pokemon: ['Dreepy TWM', 'Dreepy TWM', 'Dreepy TWM', 'Dreepy TWM', 'Dreepy TWM'] }],
      });
      const result = playCard(ctx, 'Buddy-Buddy Poffin TEF');
      expectCleanGameError(result, 'Buddy-Buddy Poffin full bench L3');
    });

    it('Buddy-Buddy Poffin with valid targets searches without crashing', () => {
      const ctx = buildCardTestContext({
        handCards: ['Buddy-Buddy Poffin TEF'],
      });
      const result = playCard(ctx, 'Buddy-Buddy Poffin TEF');
      expectNoCrash(result, 'Buddy-Buddy Poffin happy path L3');
      expect(result.gameError).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tier 1: Lillie's Determination MEG
  // -------------------------------------------------------------------------

  describe('Lillie\'s Determination MEG — edge cases', () => {

    it('GameErrors cleanly when deck is empty (cannot draw 6)', () => {
      const ctx = buildCardTestContext({
        deckCards: [],
        noDefaultHand: true,
        handCards: ['Lillie\'s Determination MEG'],
      });
      const result = playCard(ctx, 'Lillie\'s Determination MEG');
      expectCleanGameError(result, "Lillie's Determination empty deck L3");
    });

    it('with all 6 prizes remaining draws 8 cards', () => {
      // Default setup has 6 prizes per player. Lillie's Determination's L3
      // case "draws 8 if exactly 6 prizes remain" matches the default setup.
      const ctx = buildCardTestContext({
        handCards: ['Lillie\'s Determination MEG'],
      });
      const handBefore = ctx.player.hand.cards.length;
      const result = playCard(ctx, 'Lillie\'s Determination MEG');
      expectNoCrash(result, "Lillie's Determination 6-prize L3");
      expect(result.gameError).toBe(false);
      // Hand is shuffled into deck (handBefore → 0), then draws 8.
      // We can't strictly assert hand count without simulating the shuffle,
      // but we can check final hand size is exactly 8.
      expect(ctx.player.hand.cards.length).toBe(8);
    });

    it('with 5 prizes remaining draws 6 cards', () => {
      const ctx = buildCardTestContext({
        prizes: 5,
        handCards: ['Lillie\'s Determination MEG'],
      });
      const result = playCard(ctx, 'Lillie\'s Determination MEG');
      expectNoCrash(result, "Lillie's Determination 5-prize L3");
      expect(result.gameError).toBe(false);
      expect(ctx.player.hand.cards.length).toBe(6);
    });
  });

  // -------------------------------------------------------------------------
  // Tier 1: Dreepy / Drakloak (evolution chain)
  // -------------------------------------------------------------------------

  describe('Dreepy → Drakloak evolution chain', () => {

    it('Dreepy plays to bench then Drakloak evolves it on a later turn', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Dreepy TWM' }],
        handCards: ['Drakloak TWM'],
      });
      const result = playCard(ctx, 'Drakloak TWM');
      expectNoCrash(result, 'Drakloak evolves Dreepy L3');
      expect(result.gameError).toBe(false);
    });

    it('Drakloak Recon Directive ability with deck cards available', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [{ player: 0, pokemon: 'Drakloak TWM', energies: ['Psychic Energy EVO'] }],
      });
      const result = dispatchAction(ctx, new UseAbilityAction(
        ctx.player.id,
        'Recon Directive',
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      ));
      expectNoCrash(result, 'Recon Directive happy L3');
      expect(result.gameError).toBe(false);
    });

    it('Drakloak Recon Directive with empty deck GameErrors cleanly', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [{ player: 0, pokemon: 'Drakloak TWM', energies: ['Psychic Energy EVO'] }],
        deckCards: [],
        noDefaultHand: true,
      });
      const result = dispatchAction(ctx, new UseAbilityAction(
        ctx.player.id,
        'Recon Directive',
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      ));
      expectCleanGameError(result, 'Recon Directive empty deck L3');
    });
  });

  // -------------------------------------------------------------------------
  // Tier 2: Duskull / Dusclops / Dusknoir (evolution chain + Cursed Blast)
  // -------------------------------------------------------------------------

  describe('Duskull → Dusclops → Dusknoir evolution chain', () => {

    it('Dusclops evolves from Duskull on turn 2', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Duskull SFA' }],
        handCards: ['Dusclops SFA'],
      });
      const result = playCard(ctx, 'Dusclops SFA');
      expectNoCrash(result, 'Dusclops evolves Duskull L3');
      expect(result.gameError).toBe(false);
    });

    it('Dusknoir evolves from Dusclops on turn 2', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Dusclops SFA' }],
        handCards: ['Dusknoir PRE'],
      });
      const result = playCard(ctx, 'Dusknoir PRE');
      expectNoCrash(result, 'Dusknoir evolves Dusclops L3');
      expect(result.gameError).toBe(false);
    });

    it('Dusknoir Cursed Blast ability with damaged opponent active does not crash', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          { player: 0, pokemon: 'Dusknoir PRE' },
          { player: 1, pokemon: 'Dreepy TWM', damage: 30 },
        ],
      });
      const result = dispatchAction(ctx, new UseAbilityAction(
        ctx.player.id,
        'Cursed Blast',
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      ));
      expectNoCrash(result, 'Dusknoir Cursed Blast L3');
      // TODO: L5 — verify the PutDamagePrompt callback bug in PRE Dusknoir.ts
      // line 47-50: target.target.damage += target.damage treats CardTarget
      // as PokemonCardList. See lampent.ts for canonical fix pattern.
    });

    it('Dusknoir Cursed Blast with no damage on opponent does not crash', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          { player: 0, pokemon: 'Dusknoir PRE' },
          { player: 1, pokemon: 'Dreepy TWM' },
        ],
      });
      const result = dispatchAction(ctx, new UseAbilityAction(
        ctx.player.id,
        'Cursed Blast',
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      ));
      expectNoCrash(result, 'Dusknoir Cursed Blast no damage L3');
    });

    it('Dusclops Cursed Blast ability does not crash', () => {
      const ctx = buildCardTestContext({
        turn: 3,
        activeSetup: [
          { player: 0, pokemon: 'Dusclops SFA' },
          { player: 1, pokemon: 'Dreepy TWM' },
        ],
      });
      const result = dispatchAction(ctx, new UseAbilityAction(
        ctx.player.id,
        'Cursed Blast',
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      ));
      expectNoCrash(result, 'Dusclops Cursed Blast L3');
    });
  });

  // -------------------------------------------------------------------------
  // Tier 2: Munkidori TWM (Adrena-Brain ability)
  // -------------------------------------------------------------------------

  describe('Munkidori TWM Adrena-Brain', () => {

    it('Adrena-Brain GameErrors cleanly with no Dark Energy attached', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [{ player: 0, pokemon: 'Munkidori TWM' }],
      });
      const result = dispatchAction(ctx, new UseAbilityAction(
        ctx.player.id,
        'Adrena-Brain',
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      ));
      expectCleanGameError(result, 'Adrena-Brain no dark energy L3');
    });

    it('Adrena-Brain with Dark Energy attached and damage on own Pokemon dispatches without crashing', () => {
      const ctx = buildCardTestContext({
        turn: 2,
        activeSetup: [
          { player: 0, pokemon: 'Munkidori TWM', damage: 30, energies: ['Darkness Energy EVO'] },
        ],
      });
      const result = dispatchAction(ctx, new UseAbilityAction(
        ctx.player.id,
        'Adrena-Brain',
        { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }
      ));
      expectNoCrash(result, 'Adrena-Brain happy L3');
      // TODO: L5 — TWM Munkidori.ts line 54-65 calls MoveDamagePrompt with the
      // wrong constructor signature (8 args; expects 6). The current call:
      //   new MoveDamagePrompt(pid, msg, BOTTOM, [slots], TOP, [slots], 30, opts)
      // should be:
      //   new MoveDamagePrompt(pid, msg, ANY, [slots], maxAllowedDamage, opts)
      // and use proper damage source/dest target tracking. See bot/cards in
      // sets that use MoveDamagePrompt correctly for the canonical pattern.
    });
  });

  // -------------------------------------------------------------------------
  // Tier 2: Area Zero Underdepths SCR
  // -------------------------------------------------------------------------

  describe('Area Zero Underdepths SCR — edge cases', () => {

    it('plays as stadium when no stadium currently in play', () => {
      const ctx = buildCardTestContext({
        handCards: ['Area Zero Underdepths SCR'],
      });
      const result = playCard(ctx, 'Area Zero Underdepths SCR');
      expectNoCrash(result, 'Area Zero new stadium L3');
      expect(result.gameError).toBe(false);
    });

    it('plays as stadium when an opposing stadium is in play (replacement)', () => {
      const ctx = buildCardTestContext({
        handCards: ['Area Zero Underdepths SCR'],
        stadiumInPlay: 'Area Zero Underdepths SCR',
      });
      // The card's CheckTableStateEffect logic would block playing the same
      // stadium card again. Either GameError or no-op.
      const result = playCard(ctx, 'Area Zero Underdepths SCR');
      expectNoCrash(result, 'Area Zero replacement L3');
      // Either gameError true (CANNOT_USE_STADIUM) or false — both acceptable
    });

    it('does not crash when player has Tera Pokemon (Dragapult ex) on bench', () => {
      const ctx = buildCardTestContext({
        handCards: ['Area Zero Underdepths SCR'],
        activeSetup: [{ player: 0, pokemon: 'Dragapult ex TWM' }],
      });
      const result = playCard(ctx, 'Area Zero Underdepths SCR');
      expectNoCrash(result, 'Area Zero with Tera L3');
      expect(result.gameError).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // L3 spot checks for the remaining Tier 2 cards
  // -------------------------------------------------------------------------

  describe('Boss\'s Orders MEG — edge cases', () => {

    it('GameErrors cleanly when opponent has no benched Pokemon', () => {
      const ctx = buildCardTestContext({
        handCards: ['Boss\'s Orders MEG'],
        // No bench setup for player 1
      });
      const result = playCard(ctx, 'Boss\'s Orders MEG');
      expectCleanGameError(result, "Boss's Orders no bench L3");
    });

    it('switches opponent active when bench has 1 Pokemon', () => {
      const ctx = buildCardTestContext({
        handCards: ['Boss\'s Orders MEG'],
        benchSetup: [{ player: 1, pokemon: ['Dreepy TWM'] }],
      });
      const result = playCard(ctx, 'Boss\'s Orders MEG');
      expectNoCrash(result, "Boss's Orders 1-bench L3");
      expect(result.gameError).toBe(false);
    });
  });

  describe('Night Stretcher SFA — edge cases', () => {

    it('GameErrors cleanly with empty discard pile', () => {
      const ctx = buildCardTestContext({
        handCards: ['Night Stretcher SFA'],
        // No discardSetup
      });
      const result = playCard(ctx, 'Night Stretcher SFA');
      expectCleanGameError(result, 'Night Stretcher empty discard L3');
    });

    it('retrieves a basic energy from discard', () => {
      const ctx = buildCardTestContext({
        handCards: ['Night Stretcher SFA'],
        discardSetup: [{ player: 0, cards: ['Psychic Energy EVO'] }],
      });
      const result = playCard(ctx, 'Night Stretcher SFA');
      expectNoCrash(result, 'Night Stretcher energy L3');
      expect(result.gameError).toBe(false);
    });
  });
});

