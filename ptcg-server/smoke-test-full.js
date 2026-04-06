/**
 * Full-flow smoke test — goes through setup phase like a real sandbox game,
 * then tries to play cards. Mirrors what happens when the user clicks Start Sandbox.
 */

require('./config');
const sets = require('./output/sets');
const { CardManager } = require('./output/game/cards/card-manager');
const { StateSerializer } = require('./output/game/serializer/state-serializer');

const cardManager = CardManager.getInstance();
cardManager.defineSet(sets.setDiamondAndPearl);
cardManager.defineSet(sets.setOp9);
cardManager.defineSet(sets.setHgss);
cardManager.defineSet(sets.setBlackAndWhite);
cardManager.defineSet(sets.setBlackAndWhite2);
cardManager.defineSet(sets.setBlackAndWhite3);
cardManager.defineSet(sets.setBlackAndWhite4);
cardManager.defineSet(sets.setXY);
cardManager.defineSet(sets.setSunAndMoon);
cardManager.defineSet(sets.setSwordAndShield);
cardManager.defineSet(sets.setScarletAndViolet);
StateSerializer.setKnownCards(cardManager.getAllCards());

const { Store } = require('./output/game/store/store');
const { AddPlayerAction } = require('./output/game/store/actions/add-player-action');
const { PlayCardAction, PlayerType, SlotType } = require('./output/game/store/actions/play-card-action');
const { ResolvePromptAction } = require('./output/game/store/actions/resolve-prompt-action');
const { GamePhase } = require('./output/game/store/state/state');
const { Arbiter } = require('./output/game/core/arbiter');

// Suppress debug logs from server instrumentation
const _log = console.log, _err = console.error;
let suppress = true;
console.log = function(...a) { if (suppress && typeof a[0] === 'string' && /^\[(dispatch|store|playCardReducer|propagateEffect)/.test(a[0])) return; _log.apply(console, a); };
console.error = function(...a) { if (suppress && typeof a[0] === 'string' && /^\[(dispatch|store|playCardReducer|propagateEffect)/.test(a[0])) return; _err.apply(console, a); };

const LUCARDIO_CARDS = [
  ...Array(4).fill('Riolu MEG'),
  ...Array(3).fill('Mega Lucario ex MEG'),
  ...Array(2).fill('Solrock MEG'),
  ...Array(2).fill('Hariyama MEG'),
  ...Array(2).fill('Lunatone MEG'),
  ...Array(2).fill('Makuhita MEG'),
  'Meowth ex POR',
  'Shaymin DRI',
  ...Array(4).fill('Premium Power Pro MEG'),
  ...Array(4).fill('Fighting Gong MEG'),
  ...Array(4).fill("Lillie's Determination MEG"),
  ...Array(3).fill('Ultra Ball PLB'),
  ...Array(3).fill('Poke Pad POR'),
  ...Array(3).fill('Carmine TWM'),
  ...Array(2).fill('Night Stretcher SFA'),
  ...Array(2).fill("Team Rocket's Watchtower DRI"),
  ...Array(2).fill('Judge DRI'),
  'Air Balloon ASC',
  'Switch SSH',
  'Special Red Card M4',
  'Maximum Belt TEF',
  "Boss's Orders MEG",
  ...Array(11).fill('Fighting Energy EVO'),
];

const DRAGAPULT_CARDS = [
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
  "Lillie's Clefairy ex JTG",
  ...Array(4).fill("Lillie's Determination MEG"),
  ...Array(4).fill('Ultra Ball PLB'),
  ...Array(4).fill('Poke Pad POR'),
  ...Array(4).fill('Buddy-Buddy Poffin TEF'),
  ...Array(2).fill("Boss's Orders MEG"),
  ...Array(2).fill('Night Stretcher SFA'),
  ...Array(2).fill('Rare Candy SUM'),
  ...Array(2).fill('Area Zero Underdepths SCR'),
  ...Array(2).fill('Crispin SCR'),
  'Unfair Stamp TWM',
  'Dawn PFL',
  "Team Rocket's Petrel DRI",
  ...Array(2).fill('Darkness Energy EVO'),
  ...Array(3).fill('Psychic Energy EVO'),
  ...Array(3).fill('Fire Energy EVO'),
];

// Auto-resolve prompts using the Arbiter for shuffles/coinflips,
// plus manual handling for setup prompts.
function resolveSetupPrompts(store, maxIter = 100) {
  const arbiter = new Arbiter();
  let iter = 0;
  while (iter++ < maxIter) {
    const unresolved = store.state.prompts.filter(p => p.result === undefined);
    if (unresolved.length === 0) break;

    let progressed = false;
    for (const prompt of unresolved) {
      // Try arbiter first (shuffles, coin flips)
      const action = arbiter.resolvePrompt(store.state, prompt);
      if (action) {
        store.dispatch(action);
        progressed = true;
        break;
      }

      const typeName = prompt.constructor.name;

      if (typeName === 'AlertPrompt' || typeName === 'ShowCardsPrompt') {
        store.dispatch(new ResolvePromptAction(prompt.id, true));
        progressed = true;
        break;
      }

      if (typeName === 'ConfirmPrompt') {
        store.dispatch(new ResolvePromptAction(prompt.id, true));
        progressed = true;
        break;
      }

      if (typeName === 'ChooseCardsPrompt') {
        // For setup: pick the first basic Pokemon
        const cards = prompt.cards.cards;
        const indices = [];
        for (let i = 0; i < cards.length && indices.length < prompt.options.min; i++) {
          const c = cards[i];
          // Match prompt filter (basic pokemon during setup)
          if (prompt.filter && prompt.filter.superType !== undefined) {
            if (c.superType === prompt.filter.superType &&
                (prompt.filter.stage === undefined || c.stage === prompt.filter.stage)) {
              indices.push(i);
            }
          } else {
            indices.push(i);
          }
        }
        if (indices.length >= prompt.options.min) {
          const chosenCards = indices.map(i => cards[i]);
          store.dispatch(new ResolvePromptAction(prompt.id, chosenCards));
          progressed = true;
          break;
        } else if (prompt.options.allowCancel) {
          store.dispatch(new ResolvePromptAction(prompt.id, null));
          progressed = true;
          break;
        }
      }
    }

    if (!progressed) {
      return store.state.prompts.filter(p => p.result === undefined);
    }
  }
  return store.state.prompts.filter(p => p.result === undefined);
}

function runTest() {
  console.log('=== Full-Flow Smoke Test (simulates real sandbox setup) ===\n');

  const mockHandler = { onStateChange: () => {} };
  const store = new Store(mockHandler);

  // Seed RNG to be deterministic? Not available — just rely on mulligan resolution
  console.log('Step 1: Add Player 1 (Lucardio)...');
  try {
    store.dispatch(new AddPlayerAction(2, 'player', LUCARDIO_CARDS));
    console.log('  ✓ phase =', store.state.phase, '(should be WAITING=0)');
  } catch (err) {
    console.log('  ✗ CRASH:', err.message);
    console.log(err.stack);
    return;
  }

  console.log('\nStep 2: Add Player 2 (Dragapult, sandbox id)...');
  try {
    store.dispatch(new AddPlayerAction(100002, 'player (P2)', DRAGAPULT_CARDS));
    console.log('  ✓ phase =', store.state.phase, '(should be SETUP=1 or PLAYER_TURN=2)');
  } catch (err) {
    console.log('  ✗ CRASH:', err.message);
    console.log(err.stack);
    return;
  }

  console.log('\nStep 3: Auto-resolve setup prompts...');
  const stillUnresolved = resolveSetupPrompts(store);
  console.log('  Phase after setup:', store.state.phase, '(2 = PLAYER_TURN)');
  console.log('  Turn:', store.state.turn);
  console.log('  Unresolved prompts:', stillUnresolved.length);
  if (stillUnresolved.length > 0) {
    console.log('  Unresolved:', stillUnresolved.map(p => p.constructor.name).join(', '));
  }

  if (store.state.phase !== GamePhase.PLAYER_TURN) {
    console.log('\n✗ Could not reach PLAYER_TURN phase');
    return;
  }

  const active = store.state.players[store.state.activePlayer];
  console.log(`  Active player: ${active.name} (id ${active.id})`);
  console.log(`  Hand size: ${active.hand.cards.length}`);
  console.log(`  Active Pokemon: ${active.active.getPokemonCard()?.name || 'NONE'}`);
  console.log(`  Bench: [${active.bench.map(b => b.getPokemonCard()?.name || '-').join(', ')}]`);

  console.log('\nStep 4: Try playing each card from the active player\'s hand...');
  const results = { pass: [], fail: [] };

  // Snapshot state so we can restore between attempts
  const snapshot = JSON.parse(JSON.stringify({
    phase: store.state.phase,
    turn: store.state.turn,
    activePlayer: store.state.activePlayer,
  }));

  // Save hand for restoration between tests
  const originalHand = active.hand.cards.slice();

  for (let i = 0; i < originalHand.length; i++) {
    const card = originalHand[i];
    // Ensure hand is restored (the play may have moved cards)
    // We re-snapshot using a fresh store each time — too expensive. Instead, check after:
    const handNow = active.hand.cards;
    const cardIndex = handNow.indexOf(card);
    if (cardIndex === -1) {
      // Card no longer in hand (was played earlier or discarded by another effect)
      console.log(`  - ${card.fullName} (already played/moved)`);
      continue;
    }

    // Pick target based on card type
    let target;
    if (card.superType === 3) { // ENERGY
      target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    } else if (card.superType === 1 && card.stage === 2) { // BASIC POKEMON
      // Find empty bench slot
      const emptyIdx = active.bench.findIndex(b => b.cards.length === 0);
      if (emptyIdx === -1) {
        console.log(`  - ${card.fullName} (bench full)`);
        continue;
      }
      target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: emptyIdx };
    } else if (card.superType === 1) { // EVOLUTION
      // Try to evolve active
      target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    } else { // TRAINER
      target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BOARD, index: 0 };
    }

    try {
      // Reset energy flag to allow multi-attach testing
      active.energyPlayedTurn = 0;
      store.dispatch(new PlayCardAction(active.id, cardIndex, target));

      // Auto-resolve any prompts the card created
      resolveSetupPrompts(store);

      console.log(`  ✓ ${card.fullName}`);
      results.pass.push(card.fullName);
    } catch (err) {
      const isGameErr = err.constructor && err.constructor.name === 'GameError';
      const msg = err.message;
      const expected = ['CANNOT_PLAY_THIS_CARD', 'INVALID_TARGET', 'SUPPORTER_ALREADY_PLAYED', 'STADIUM_ALREADY_PLAYED', 'ENERGY_ALREADY_ATTACHED', 'CANNOT_EVOLVE_THIS_TURN'];
      if (isGameErr && expected.includes(msg)) {
        console.log(`  ~ ${card.fullName} (expected GameError: ${msg})`);
        results.pass.push(card.fullName);
      } else if (isGameErr) {
        console.log(`  ✗ ${card.fullName} — GameError: ${msg}`);
        results.fail.push({ name: card.fullName, error: `GameError: ${msg}` });
      } else {
        console.log(`  ✗ ${card.fullName} — CRASH: ${msg}`);
        console.log('    ', (err.stack || '').split('\n').slice(1, 4).join('\n     '));
        results.fail.push({ name: card.fullName, error: msg });
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`✓ Pass: ${results.pass.length}`);
  console.log(`✗ Fail: ${results.fail.length}`);
  if (results.fail.length > 0) {
    console.log('\n--- FAILURES ---');
    for (const f of results.fail) console.log(`  ${f.name}: ${f.error}`);
  }
}

runTest();
