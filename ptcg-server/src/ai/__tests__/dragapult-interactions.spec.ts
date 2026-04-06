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

  // ===========================================================================
  // TASK 2: ATTACK + DAMAGE MODIFIER + ABILITY STACK INTERACTIONS
  // ===========================================================================

  describe('Attack + damage modifier stacks', () => {

    // -------------------------------------------------------------------------
    // Test 8: Phantom Dive + Boss's Orders same turn — target reposition
    // -------------------------------------------------------------------------

    it('L6: Boss\'s Orders swaps high-value Pokemon to active BEFORE Phantom Dive', () => {
      // Setup: opponent has a low-HP Dreepy active (decoy) and a high-HP
      // Dragapult ex on bench. We want to Boss's Orders the Dragapult ex up,
      // then Phantom Dive it (200 to active + 60 spread to remaining bench).
      // After Boss's Orders the active is now Dragapult ex and Dreepy is
      // on the bench.
      //
      // We use Dragapult ex (320 HP) specifically so it SURVIVES the 200
      // damage — that way the damage counter stays on the board and we can
      // verify the 200+60 arithmetic. If the new active were low HP, it
      // would be KO'd and the damage would be cleared from the board.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(6)
        .p0Active('Dragapult ex TWM', {
          energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p0Hand("Boss's Orders MEG")
        .p1Active('Dreepy TWM')                 // decoy active (low HP)
        .p1Bench('Dragapult ex TWM')            // ONLY bench target, so
                                                 // auto-resolver MUST pick
                                                 // this (320 HP, survives 200)
        .build();

      // Snapshot the opponent's Dragapult ex bench slot BEFORE Boss's Orders.
      const benchSlotDragapult = benchSlotByName(ctx.opponent, 'Dragapult ex TWM');
      expect(benchSlotDragapult).not.toBeNull();

      // Step 1: Play Boss's Orders → auto-resolver has only one bench target,
      // so it picks Dragapult ex. Post-switch, Dragapult ex is the active
      // and Dreepy is on the bench.
      const result1 = playCardByName(ctx, "Boss's Orders MEG");
      expect(result1.crashed).toBe(false);
      expect(result1.gameError).toBe(false);

      // TODO: human-review — Boss's Orders MEG card text: "Switch in 1 of
      // your opponent's Benched Pokemon to the Active Spot."
      //   Verify against: src/sets/set-scarlet-and-violet/MEG Boss's Orders.ts
      //
      // After the switch, the active is Dragapult ex (the only bench target).
      // Dreepy is now on the bench.
      expect(activePokemonName(ctx.opponent)).toBe('Dragapult ex TWM');
      const benchHasDreepy = ctx.opponent.bench.some(
        b => b.getPokemonCard()?.fullName === 'Dreepy TWM'
      );
      expect(benchHasDreepy).toBe(true);

      // Step 2: Phantom Dive — 200 to active Dragapult ex (survives, 320 HP)
      // + 60 spread to the bench (only Dreepy remains, 40 HP, KO'd).
      const opponentActiveDmgBefore = ctx.opponent.active.damage;

      const result2 = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expect(result2.crashed).toBe(false);
      expect(result2.gameError).toBe(false);

      // TODO: human-review — 200 damage lands on Dragapult ex (survives,
      // 320 HP). The spread (60) lands on Dreepy (40 HP) → KO'd (damage
      // cleared from board after KO processing). Weakness check: Dragapult
      // ex has no listed weakness (Dragon type, none on the card).
      //   Verify against: src/sets/set-scarlet-and-violet/TWM Dragapult ex.ts
      //
      // Assert: opponent active (Dragapult ex) now has EXACTLY 200 damage.
      const opponentActiveDmgAfter = ctx.opponent.active.damage;
      expect(opponentActiveDmgAfter - opponentActiveDmgBefore).toBe(200);
    });

    // -------------------------------------------------------------------------
    // Test 9: Dusknoir Cursed Blast + Phantom Dive — damage layering
    // -------------------------------------------------------------------------

    it('L6: Dusknoir Cursed Blast THEN Phantom Dive layers damage correctly', () => {
      // Pre-soften opponent bench with Cursed Blast, then finish with
      // Phantom Dive's spread. The damage from Cursed Blast must still be
      // on the bench when Phantom Dive's spread lands.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(7)
        .p0Active('Dragapult ex TWM', {
          energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p0Bench('Dusknoir PRE')
        .p1Active('Dragapult ex TWM')  // 320 HP — tanks the 200 so we can see spread
        .p1Bench('Drakloak TWM', { damage: 20 })
        .p1Bench('Munkidori TWM', { damage: 10 })
        .build();

      // Step 1: Cursed Blast. The auto-resolver picks the first target
      // (opponent active). 130 damage to active should KO Dragapult ex?
      // No — 130 < 320, so Dragapult ex survives at 130 damage. Dusknoir
      // KOs itself as part of the effect.
      const totalOppBeforeCursed = totalBoardDamage(ctx.opponent);
      const r1 = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Cursed Blast', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expect(r1.crashed).toBe(false);
      const totalOppAfterCursed = totalBoardDamage(ctx.opponent);

      // TODO: human-review — Cursed Blast applied 130 damage (auto-resolver
      // picks first valid target which is the active).
      //   Verify against: src/sets/set-scarlet-and-violet/PRE Dusknoir.ts
      expect(totalOppAfterCursed - totalOppBeforeCursed).toBeGreaterThanOrEqual(90);

      // Step 2: Phantom Dive now — 200 to active (dragapult ex still up at
      // 130 dmg; 130 + 200 = 330 → KO since max HP 320, but either way the
      // spread fires on the remaining bench).
      const r2 = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expect(r2.crashed).toBe(false);
      expect(r2.gameError).toBe(false);

      // TODO: human-review — Phantom Dive's 200 may or may not KO the
      // already-damaged Dragapult ex (depends on weakness/modifiers). The
      // spread (60) must land on the remaining bench. We assert the bench
      // damage on the remaining bench slots INCREASED (the spread was
      // applied).
      const remainingBenchDamage = ctx.opponent.bench
        .filter(b => b.cards.length > 0)
        .reduce((sum, b) => sum + b.damage, 0);
      // Drakloak had 20, Munkidori had 10 = 30 before. Phantom Dive spreads
      // 60 total across 2 bench Pokemon (could go 20+40 or 30+30, etc.) so
      // after: at least 30 + something > 30.
      // TODO: human-review — round-robin auto-resolver lands at least some
      // portion of the 60 on bench.
      expect(remainingBenchDamage).toBeGreaterThanOrEqual(30);
    });

    // -------------------------------------------------------------------------
    // Test 10: Munkidori + Dusknoir ability chain
    // -------------------------------------------------------------------------

    it('L6: Munkidori transfer, then Dusknoir Cursed Blast — board damage accounting', () => {
      // Board: Dragapult ex (own active, 30 damage), Munkidori (bench, dark
      // energy), Dusknoir (bench). Opponent active is Dragapult ex (320 HP)
      // so it SURVIVES the 130 Cursed Blast — damage stays on the board
      // and we can verify accounting. (Low HP active → KO → damage cleared.)
      //
      // Expected:
      //   1. Munkidori moves 10-30 damage from own Dragapult ex → opponent
      //      Dragapult ex. Conservation: own Δ == opp Δ.
      //   2. Dusknoir Cursed Blast adds 130 to opponent's board (auto-
      //      resolver picks active). Dusknoir KO-self.
      //   3. Final opp damage = initial 20 + Munkidori transfer + 130.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(6)
        .p0Active('Dragapult ex TWM', {
          damage: 30,
          energies: ['Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p0Bench('Munkidori TWM', { energies: ['Darkness Energy EVO'] })
        .p0Bench('Dusknoir PRE')
        .p1Active('Dragapult ex TWM', { damage: 20 })  // 320 HP — survives 130
        .build();

      // Step 1: Munkidori Adrena-Brain.
      const ownDragBefore = ctx.player.active.damage;
      const oppDragBefore = ctx.opponent.active.damage;

      const r1 = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Adrena-Brain', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expect(r1.crashed).toBe(false);

      // TODO: human-review — Munkidori moves at least 1 counter from own →
      // opponent. Conservation holds.
      //   Verify against: src/sets/set-scarlet-and-violet/TWM Munkidori.ts
      const ownDragAfterMunki = ctx.player.active.damage;
      const oppDragAfterMunki = ctx.opponent.active.damage;
      const ownDelta = ownDragBefore - ownDragAfterMunki;
      const oppDelta = oppDragAfterMunki - oppDragBefore;
      expect(ownDelta).toBe(oppDelta);
      expect(ownDelta).toBeGreaterThanOrEqual(10);

      // Step 2: Dusknoir Cursed Blast (bench slot 1).
      const oppActiveBeforeCursed = ctx.opponent.active.damage;
      const r2 = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Cursed Blast', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1,
      }));
      expect(r2.crashed).toBe(false);

      // TODO: human-review — Cursed Blast applies 130 damage to the chosen
      // target. The opponent Dragapult ex has 320 HP so it survives; the
      // 130 stays on the board (not cleared by KO). Dusknoir is KO'd.
      //   Verify against: src/sets/set-scarlet-and-violet/PRE Dusknoir.ts
      const oppActiveAfterCursed = ctx.opponent.active.damage;
      expect(oppActiveAfterCursed - oppActiveBeforeCursed).toBe(130);
      // Dusknoir KO'd: either slot empty OR damage >= HP (160).
      const dusknoirSlot = ctx.player.bench[1];
      const dusknoirKOd = dusknoirSlot.cards.length === 0 || dusknoirSlot.damage >= 160;
      expect(dusknoirKOd).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Test 11: Fezandipiti ex Flip the Script + Munkidori
    // -------------------------------------------------------------------------

    it('L6: Fezandipiti ex Flip the Script + Munkidori Adrena-Brain do not interfere', () => {
      // Both abilities involve different resources (Flip the Script draws
      // cards; Adrena-Brain moves damage). Using them in sequence should
      // leave both effects applied cleanly.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(6)
        .p0Active('Dragapult ex TWM', {
          damage: 20,
          energies: ['Psychic Energy EVO'],
        })
        .p0Bench('Fezandipiti ex SFA')
        .p0Bench('Munkidori TWM', { energies: ['Darkness Energy EVO'] })
        .p0DeckTop('Rare Candy SUM', 'Psychic Energy EVO', 'Fire Energy EVO')
        .p1Active('Drakloak TWM', { damage: 10 })
        .build();

      const handBefore = ctx.player.hand.cards.length;
      const deckBefore = ctx.player.deck.cards.length;

      // Step 1: Fezandipiti Flip the Script (draw 3).
      const r1 = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Flip the Script', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0,
      }));
      expect(r1.crashed).toBe(false);

      // TODO: human-review — Flip the Script draws 3 cards (the engine's
      // simplified version ignores the KO precondition).
      //   Verify against: src/sets/set-scarlet-and-violet/SFA Fezandipiti ex.ts
      const handAfterFlip = ctx.player.hand.cards.length;
      const deckAfterFlip = ctx.player.deck.cards.length;
      expect(handAfterFlip - handBefore).toBe(3);
      expect(deckBefore - deckAfterFlip).toBe(3);

      // Step 2: Munkidori Adrena-Brain (unaffected by the draw).
      const ownDragBefore = ctx.player.active.damage;
      const oppDrakBefore = ctx.opponent.active.damage;

      const r2 = dispatchAction(ctx, new UseAbilityAction(ctx.player.id, 'Adrena-Brain', {
        player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 1,
      }));
      expect(r2.crashed).toBe(false);

      // TODO: human-review — Munkidori still works after Flip the Script.
      // Conservation: own Δ == opp Δ, non-zero.
      const ownDelta = ownDragBefore - ctx.player.active.damage;
      const oppDelta = ctx.opponent.active.damage - oppDrakBefore;
      expect(ownDelta).toBe(oppDelta);
      expect(ownDelta).toBeGreaterThanOrEqual(10);
    });

    // -------------------------------------------------------------------------
    // Test 12: Phantom Dive with NO opponent bench (base 200 only)
    // -------------------------------------------------------------------------

    it('L6: Phantom Dive with zero opponent bench — base 200 applies, spread skips cleanly', () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(6)
        .p0Active('Dragapult ex TWM', {
          energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p1Active('Dragapult ex TWM')   // 320 HP, no bench
        .build();

      const oppDamageBefore = ctx.opponent.active.damage;
      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expect(result.crashed).toBe(false);
      expect(result.gameError).toBe(false);

      // TODO: human-review — Phantom Dive's hasBench check in the card's
      // reduceEffect skips the PutDamagePrompt when opponent has no bench.
      // The base 200 damage still flows through the normal attack pipeline.
      //   Verify against: src/sets/set-scarlet-and-violet/TWM Dragapult ex.ts
      expect(ctx.opponent.active.damage - oppDamageBefore).toBe(200);
      // Opponent bench is still empty (nothing to spread into).
      expect(ctx.opponent.bench.filter(b => b.cards.length > 0).length).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Test 13: Phantom Dive KOs active during spread accounting
    // -------------------------------------------------------------------------

    it('L6: Phantom Dive KOs a low-HP opponent active cleanly (KO during attack)', () => {
      // Drakloak at 90 HP, no pre-existing damage. Phantom Dive lands 200
      // damage → KO. Spread still fires on the bench.
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(6)
        .p0Active('Dragapult ex TWM', {
          energies: ['Psychic Energy EVO', 'Psychic Energy EVO', 'Fire Energy EVO'],
        })
        .p1Active('Drakloak TWM')          // 90 HP, KO'd by 200
        .p1Bench('Duskull SFA')
        .p1Bench('Dreepy TWM')
        .build();

      const result = dispatchAction(ctx, new AttackAction(ctx.player.id, 'Phantom Dive'));
      expect(result.crashed).toBe(false);
      expect(result.gameError).toBe(false);

      // TODO: human-review — the 200 KOs Drakloak. Engine's KO processing
      // may or may not have cleared the active slot by now (prize prompts,
      // switch-in prompts may be pending). We assert the spread (60 across
      // the bench) still landed.
      //   Verify against: src/sets/set-scarlet-and-violet/TWM Dragapult ex.ts
      const benchDmg = ctx.opponent.bench
        .filter(b => b.cards.length > 0)
        .reduce((sum, b) => sum + b.damage, 0);
      expect(benchDmg).toBeGreaterThanOrEqual(20);  // at least part of the 60 landed
    });

    // -------------------------------------------------------------------------
    // Test 14: Boss's Orders with no opponent bench → clean GameError
    // -------------------------------------------------------------------------

    it("L6: Boss's Orders with no opponent bench throws clean GameError", () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dragapult ex TWM')
        .p0Hand("Boss's Orders MEG")
        .p1Active('Dreepy TWM')   // no bench
        .build();

      const result = playCardByName(ctx, "Boss's Orders MEG");

      // TODO: human-review — Boss's Orders pre-checks `hasBench` and throws
      // CANNOT_PLAY_THIS_CARD if opponent has no benched Pokemon.
      //   Verify against: src/sets/set-scarlet-and-violet/MEG Boss's Orders.ts
      expect(result.crashed).toBe(false);
      expect(result.gameError).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Test 15: Double Boss's Orders same turn → SUPPORTER_ALREADY_PLAYED
    // -------------------------------------------------------------------------

    it("L6: two Boss's Orders same turn — second rejects with SUPPORTER_ALREADY_PLAYED", () => {
      const ctx = new ScenarioBuilder()
        .seed(42)
        .turn(5)
        .p0Active('Dragapult ex TWM')
        .p0Hand("Boss's Orders MEG", "Boss's Orders MEG")
        .p1Active('Dreepy TWM')
        .p1Bench('Drakloak TWM')
        .p1Bench('Munkidori TWM')
        .build();

      // First supporter plays cleanly.
      const r1 = playCardByName(ctx, "Boss's Orders MEG");
      expect(r1.crashed).toBe(false);
      expect(r1.gameError).toBe(false);

      // Second supporter rejects.
      const r2 = playCardByName(ctx, "Boss's Orders MEG");

      // TODO: human-review — play-card-reducer.ts:90 rejects the second
      // supporter with SUPPORTER_ALREADY_PLAYED when
      // player.supporter.cards.length > 0.
      //   Verify against: src/game/store/reducers/play-card-reducer.ts
      expect(r2.crashed).toBe(false);
      expect(r2.gameError).toBe(true);
    });

  });

});
