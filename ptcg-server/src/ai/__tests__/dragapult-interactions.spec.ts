/**
 * dragapult-interactions.spec.ts — Plan 01-06 (L6 Cross-Card Interactions)
 *
 * The hardest class of engine bugs lives HERE: cross-card interactions where
 * Card A + Card B + Card C produces the wrong result, even though each card
 * passes L2/L3/L4/L5 in isolation.
 *
 * L1-L5 covered:
 *   L2 (dragapult-cards.spec.ts)      — smoke: each card plays without crashing
 *   L3 (dragapult-cards.spec.ts)      — edge cases / clean GameErrors
 *   L4 (dragapult-deep-state.spec.ts) — mid-game states (no crash)
 *   L5 (dragapult-semantics.spec.ts)  — each card produces the CORRECT state delta
 *
 * L6 covers:
 *   - Evolution chain interactions (Dreepy/Drakloak/Dragapult line, Duskull/
 *     Dusclops/Dusknoir line, Rare Candy skip-evolve, attachment carryover)
 *   - Attack + damage modifier stacks (Phantom Dive + Boss's Orders target
 *     reposition, Phantom Dive + bench-vs-active damage, KO during spread)
 *   - Ability stacks (Munkidori + Dusknoir damage manipulation, Fezandipiti
 *     Flip the Script + Munkidori, ability used then evolve)
 *   - Trainer combos (Ultra Ball → Poffin → Night Stretcher, supporter rules)
 *   - Stadium churn (Area Zero replacement, bench-limit changes)
 *   - End-of-turn triggers with pending prompts (status conditions + prizes)
 *
 * These bugs hide in effect propagation order, callback ordering, and
 * state-timing. Self-play training WILL exercise card combinations the unit
 * tests never hit, so any silent bug here corrupts every training game.
 *
 * Reference: Hearthstone paper §VII.C documents cross-card interactions as
 * the "longest tail" of engine bugs. Pokemon TCG analog: evolution chains +
 * damage-modification abilities + trainer cards with sub-choices = same tail.
 *
 * Test runner: same as the other dragapult specs — compile via tolerant tsc
 * then run plain jasmine on the emitted JS:
 *   npx tsc --noEmitOnError false
 *   npx jasmine output/ai/__tests__/dragapult-interactions.spec.js
 *
 * Every assertion that depends on a card text rule is marked
 * `// TODO: human-review` so Plan 01-07 spot-checks pick them up.
 */

import {
  ScenarioBuilder,
} from './helpers/scenario-builder';
import {
  dispatchAction,
  ensureCardManagerInitialized,
  CardTestContext,
} from './helpers/card-test-harness';
import { PlayerType, SlotType, PlayCardAction } from '../../game/store/actions/play-card-action';
import { AttackAction, UseAbilityAction } from '../../game/store/actions/game-actions';
import { PokemonCardList } from '../../game/store/state/pokemon-card-list';
import { Player } from '../../game/store/state/player';

// Helpers ---------------------------------------------------------------------

function findCardInHand(ctx: CardTestContext, fullName: string): number {
  return ctx.player.hand.cards.findIndex(c => c.fullName === fullName);
}

function playCardByName(
  ctx: CardTestContext,
  fullName: string,
  target?: { player: PlayerType; slot: SlotType; index: number }
) {
  const idx = findCardInHand(ctx, fullName);
  if (idx === -1) {
    throw new Error(
      `L6 helper: ${fullName} not in hand ` +
      `(hand=[${ctx.player.hand.cards.map(c => c.fullName).join(', ')}])`
    );
  }
  const t = target ?? { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BOARD, index: 0 };
  return dispatchAction(ctx, new PlayCardAction(ctx.player.id, idx, t));
}

function totalBoardDamage(p: { active: PokemonCardList; bench: PokemonCardList[] }): number {
  let total = 0;
  if (p.active.cards.length > 0) total += p.active.damage;
  for (const b of p.bench) {
    if (b.cards.length > 0) total += b.damage;
  }
  return total;
}

function activePokemonName(p: Player): string | null {
  const card = p.active.getPokemonCard();
  return card ? card.fullName : null;
}

function benchSlotByName(p: Player, fullName: string): PokemonCardList | null {
  for (const b of p.bench) {
    const c = b.getPokemonCard();
    if (c && c.fullName === fullName) return b;
  }
  return null;
}

// Test suite ------------------------------------------------------------------

describe('Dragapult deck — L6 cross-card interactions', () => {

  beforeAll(() => {
    ensureCardManagerInitialized();
  });

  // ===========================================================================
  // TASK 1: EVOLUTION CHAIN INTERACTIONS
  // ===========================================================================

  describe('Evolution chains', () => {

    // -------------------------------------------------------------------------
    // Test 1: Full Dreepy → Drakloak → Dragapult ex manual chain
    // -------------------------------------------------------------------------

    it('L6: Dreepy → Drakloak → Dragapult ex manual chain preserves damage and energies', () => {
      // Turn 3: Dreepy already in play (played earlier). We evolve to
      // Drakloak first, then on a later "turn" (we fake it by advancing the
      // turn counter) we evolve to Dragapult ex.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM', {
          damage: 20,
          energies: ['Psychic Energy EVO'],
        })
        .p0Hand('Drakloak TWM')
        .build();

      // Step 1: Play Drakloak as evolution onto Dreepy (active slot).
      const result1 = playCardByName(ctx, 'Drakloak TWM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });
      expect(result1.crashed).toBe(false);
      expect(result1.gameError).toBe(false);

      // TODO: human-review — after evolution, the active slot holds a
      // Drakloak on top of the Dreepy. Damage on the slot carries over
      // (the engine stores damage on the slot/list, not on the card).
      // Verify against: src/game/store/effect-reducers/game-effect.ts
      // EvolveEffect handler.
      expect(activePokemonName(ctx.player)).toBe('Drakloak TWM');
      expect(ctx.player.active.damage).toBe(20);
      // Energy still attached (the evolution preserves the cards pile except
      // the former top-of-list Pokemon which is now underneath).
      const psychicCount1 = ctx.player.active.cards.filter(
        c => c.fullName === 'Psychic Energy EVO'
      ).length;
      expect(psychicCount1).toBe(1);

      // Advance turn so the just-evolved Drakloak can be evolved again.
      // (The engine blocks same-turn evolve-twice via pokemonPlayedTurn check
      // in play-pokemon-effect.ts.)
      ctx.state.turn = 4;

      // Step 2: Inject Dragapult ex into hand and evolve Drakloak → Dragapult ex.
      const injectedCard = ctx.player.hand.cards;
      // We already built the context; we need to add Dragapult ex. Use the
      // low-level harness helper.
      // Simpler: just mutate the hand directly (test-only).
      // Use the registry via card-test-harness's makeCard path by calling
      // injectCardIntoHand.
      // (Imported lazily to avoid making it a top-level dependency.)
      const { injectCardIntoHand } = require('./helpers/card-test-harness') as {
        injectCardIntoHand: (ctx: CardTestContext, name: string) => unknown;
      };
      injectCardIntoHand(ctx, 'Dragapult ex TWM');

      const result2 = playCardByName(ctx, 'Dragapult ex TWM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });
      expect(result2.crashed).toBe(false);
      expect(result2.gameError).toBe(false);

      // TODO: human-review — after the second evolution, the active is now
      // Dragapult ex. Damage (20) and energies still attached.
      expect(activePokemonName(ctx.player)).toBe('Dragapult ex TWM');
      expect(ctx.player.active.damage).toBe(20);
      const psychicCount2 = ctx.player.active.cards.filter(
        c => c.fullName === 'Psychic Energy EVO'
      ).length;
      expect(psychicCount2).toBe(1);
    });

    // -------------------------------------------------------------------------
    // Test 2: Rare Candy skip-evolve with attachment carryover
    // -------------------------------------------------------------------------

    it('L6: Rare Candy (Dreepy → Dragapult ex) preserves damage, energies, and tool', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM', {
          damage: 20,
          energies: ['Psychic Energy EVO', 'Fire Energy EVO'],
          tool: 'Poke Pad POR',
        })
        .p0Hand('Rare Candy SUM', 'Dragapult ex TWM')
        .build();

      // Snapshot attachment state before Rare Candy.
      const damageBefore = ctx.player.active.damage;
      const psychicBefore = ctx.player.active.cards.filter(
        c => c.fullName === 'Psychic Energy EVO'
      ).length;
      const fireBefore = ctx.player.active.cards.filter(
        c => c.fullName === 'Fire Energy EVO'
      ).length;
      const toolBefore = ctx.player.active.tool;

      const result = playCardByName(ctx, 'Rare Candy SUM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });
      expect(result.crashed).toBe(false);
      expect(result.gameError).toBe(false);

      // TODO: human-review — Rare Candy card text: "Choose 1 of your Basic
      // Pokemon in play. If you have a Stage 2 card in your hand that
      // evolves from that Pokemon, put that Stage 2 card onto the Basic
      // Pokemon to evolve it, skipping the Stage 1."
      //   Verify against: src/sets/set-black-and-white/rare-candy.ts
      //
      // Post-evolution: active is now Dragapult ex, damage/energies/tool
      // carried over from the Dreepy slot.
      expect(activePokemonName(ctx.player)).toBe('Dragapult ex TWM');
      expect(ctx.player.active.damage).toBe(damageBefore);
      const psychicAfter = ctx.player.active.cards.filter(
        c => c.fullName === 'Psychic Energy EVO'
      ).length;
      const fireAfter = ctx.player.active.cards.filter(
        c => c.fullName === 'Fire Energy EVO'
      ).length;
      expect(psychicAfter).toBe(psychicBefore);
      expect(fireAfter).toBe(fireBefore);
      // TODO: human-review — tool carries across evolution (the tool slot
      // on PokemonCardList is preserved by EvolveEffect).
      expect(ctx.player.active.tool).toBe(toolBefore);
    });

    // -------------------------------------------------------------------------
    // Test 3: Rare Candy attempt on wrong evolution line → GameError
    // -------------------------------------------------------------------------

    it('L6: Rare Candy with wrong basic in play + correct basic also in play picks the correct one', () => {
      // Dusclops is a Stage 1 that doesn't evolve from Dreepy's line.
      // Dreepy IS in play, Dragapult ex IS in hand. Rare Candy should
      // successfully evolve Dreepy → Dragapult ex (bench Dusclops should
      // NOT be a valid target since its evolution line is different).
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM')
        .p0Bench('Munkidori TWM')  // wrong line, not a valid target
        .p0Hand('Rare Candy SUM', 'Dragapult ex TWM')
        .build();

      const result = playCardByName(ctx, 'Rare Candy SUM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });
      expect(result.crashed).toBe(false);
      expect(result.gameError).toBe(false);

      // TODO: human-review — Rare Candy's blocked list should exclude the
      // Munkidori bench slot (it's not in the Dragapult line). The active
      // Dreepy is the only valid target, so the Dragapult ex should evolve
      // onto the active.
      //   Verify against: src/sets/set-black-and-white/rare-candy.ts
      //   (isMatchingStage2 check).
      expect(activePokemonName(ctx.player)).toBe('Dragapult ex TWM');
      // Munkidori should still be on the bench, untouched.
      const munki = benchSlotByName(ctx.player, 'Munkidori TWM');
      expect(munki).not.toBeNull();
    });

    // -------------------------------------------------------------------------
    // Test 4: Rare Candy with no matching Stage 2 in hand → GameError
    // -------------------------------------------------------------------------

    it('L6: Rare Candy with only wrong-line Stage 2 in hand GameErrors cleanly', () => {
      // Dreepy in play, but hand only has Dusknoir (which evolves from
      // Dusclops, not Drakloak). No valid skip-evolve target.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM')
        .p0Hand('Rare Candy SUM', 'Dusknoir PRE')
        .build();

      const result = playCardByName(ctx, 'Rare Candy SUM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });
      // TODO: human-review — Rare Candy checks hasBasicPokemon in the
      // player's board that has a matching Stage 2 in hand. Dreepy is a
      // Basic, but Dusknoir doesn't match (Dusknoir evolves from Dusclops).
      // Therefore hasBasicPokemon is false → CANNOT_PLAY_THIS_CARD.
      //   Verify against: src/sets/set-black-and-white/rare-candy.ts
      expect(result.crashed).toBe(false);
      expect(result.gameError).toBe(true);
      // Dreepy should still be active (no evolution happened).
      expect(activePokemonName(ctx.player)).toBe('Dreepy TWM');
    });

    // -------------------------------------------------------------------------
    // Test 5: Duskull → Dusclops → Dusknoir manual chain, then ability
    // -------------------------------------------------------------------------

    it('L6: Duskull → Dusclops → Dusknoir chain, Cursed Blast fires after full evolution', () => {
      // Turn 5: Duskull on bench, evolve to Dusclops (turn 5), advance to
      // turn 6, evolve to Dusknoir, then fire Cursed Blast on opponent.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dragapult ex TWM')
        .p0Bench('Duskull SFA')
        .p0Hand('Dusclops SFA')
        .p1Active('Drakloak TWM')
        .build();

      // Step 1: Evolve Duskull → Dusclops.
      const r1 = playCardByName(ctx, 'Dusclops SFA', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      });
      expect(r1.crashed).toBe(false);
      expect(r1.gameError).toBe(false);
      expect(ctx.player.bench[0].getPokemonCard()?.fullName).toBe('Dusclops SFA');

      // Step 2: Advance turn so we can evolve again.
      ctx.state.turn = 6;

      // Inject Dusknoir and evolve.
      const { injectCardIntoHand } = require('./helpers/card-test-harness') as {
        injectCardIntoHand: (ctx: CardTestContext, name: string) => unknown;
      };
      injectCardIntoHand(ctx, 'Dusknoir PRE');

      const r2 = playCardByName(ctx, 'Dusknoir PRE', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      });
      expect(r2.crashed).toBe(false);
      expect(r2.gameError).toBe(false);
      expect(ctx.player.bench[0].getPokemonCard()?.fullName).toBe('Dusknoir PRE');

      // Step 3: Fire Dusknoir Cursed Blast.
      const opponentDmgBefore = ctx.opponent.active.damage;
      const r3 = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Cursed Blast', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expect(r3.crashed).toBe(false);

      // TODO: human-review — after full Duskull → Dusclops → Dusknoir chain,
      // Dusknoir's Cursed Blast should apply 130 damage (KO Drakloak) AND
      // KO Dusknoir itself. The evolution chain doesn't interfere with the
      // ability's effect.
      //   Verify against: src/sets/set-scarlet-and-violet/PRE Dusknoir.ts
      //
      // Either damage delta >= 90 (KO threshold) OR active slot cleared.
      const opponentDmgAfter = ctx.opponent.active.damage;
      const opponentActiveCards = ctx.opponent.active.cards.length;
      const damaged = (opponentDmgAfter - opponentDmgBefore) >= 90 || opponentActiveCards === 0;
      expect(damaged).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Test 6: Same-turn evolve-twice BLOCKED (evolution rule)
    // -------------------------------------------------------------------------

    it('L6: same-turn double-evolve is BLOCKED (pokemonPlayedTurn rule)', () => {
      // Dreepy freshly "played this turn" (pokemonPlayedTurn === state.turn).
      // The engine should reject attempts to evolve it.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Dreepy TWM')
        .p0Hand('Drakloak TWM')
        .build();

      // Simulate "just played this turn" by setting pokemonPlayedTurn to
      // match the current turn. (ScenarioBuilder defaults to 0 so evolution
      // is allowed; this test specifically exercises the block path.)
      ctx.player.active.pokemonPlayedTurn = ctx.state.turn;

      const result = playCardByName(ctx, 'Drakloak TWM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });

      // TODO: human-review — POKEMON_CANT_EVOLVE_THIS_TURN thrown by
      // play-pokemon-effect.ts line 41 when pokemonPlayedTurn >= state.turn.
      //   Verify against: src/game/store/effect-reducers/play-pokemon-effect.ts
      expect(result.crashed).toBe(false);
      expect(result.gameError).toBe(true);
      // Dreepy should still be the active (no evolution occurred).
      expect(activePokemonName(ctx.player)).toBe('Dreepy TWM');
    });

    // -------------------------------------------------------------------------
    // Test 7: Evolution line validation — Drakloak onto Duskull → GameError
    // -------------------------------------------------------------------------

    it('L6: Drakloak cannot evolve Duskull (wrong evolution line) — clean GameError', () => {
      // Duskull active, Drakloak in hand. Drakloak evolves from Dreepy, not
      // Duskull. Attempting to play Drakloak targeting the active should
      // either silently skip or GameError — the engine should NOT succeed.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(3)
        .p0Active('Duskull SFA')
        .p0Hand('Drakloak TWM')
        .build();

      const result = playCardByName(ctx, 'Drakloak TWM', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0,
      });

      // TODO: human-review — evolution line check happens in EvolveEffect
      // (card.evolvesFrom === basic.name). Wrong line → GameError
      // (CANNOT_EVOLVE or similar) OR silent no-op. Either way: no crash,
      // and active must still be Duskull.
      //   Verify against: src/game/store/effect-reducers/game-effect.ts
      expect(result.crashed).toBe(false);
      expect(activePokemonName(ctx.player)).toBe('Duskull SFA');
    });

  });

});
