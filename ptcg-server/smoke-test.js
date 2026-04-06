/**
 * Card Smoke Test — headless, no server/socket needed.
 *
 * Creates a game state at PLAYER_TURN and tries to play every unique card
 * from both decks. Reports which cards crash and why.
 *
 * Usage: node smoke-test.js
 */

// Bootstrap CardManager with all sets (same as start.js)
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
const { CardList } = require('./output/game/store/state/card-list');
const { PokemonCardList } = require('./output/game/store/state/pokemon-card-list');
const { Player } = require('./output/game/store/state/player');
const { State, GamePhase } = require('./output/game/store/state/state');
const { PlayCardAction, PlayerType, SlotType } = require('./output/game/store/actions/play-card-action');
const { ResolvePromptAction } = require('./output/game/store/actions/resolve-prompt-action');
const { deepClone } = require('./output/utils/utils');

// ---- Deck definitions (same as default-decks.ts) ----
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

// ---- Helper: create a player with proper zones ----
function createPlayer(id, name) {
  const player = new Player();
  player.id = id;
  player.name = name;
  for (let i = 0; i < 6; i++) {
    const prize = new CardList();
    prize.isSecret = true;
    player.prizes.push(prize);
  }
  for (let i = 0; i < 5; i++) {
    const bench = new PokemonCardList();
    bench.isPublic = true;
    player.bench.push(bench);
  }
  player.active.isPublic = true;
  player.discard.isPublic = true;
  player.stadium.isPublic = true;
  player.supporter.isPublic = true;
  return player;
}

// ---- Helper: set up a realistic game state at PLAYER_TURN ----
function setupGameState(store, deckCards1, deckCards2) {
  const state = store.state;

  // Create players
  const player = createPlayer(1, 'Player 1');
  const opponent = createPlayer(2, 'Player 2');

  // Load decks
  player.deck = CardList.fromList(deckCards1);
  player.deck.isSecret = true;
  opponent.deck = CardList.fromList(deckCards2);
  opponent.deck.isSecret = true;

  // Assign card IDs
  let cardId = 0;
  player.deck.cards.forEach(c => { state.cardNames.push(c.fullName); c.id = cardId++; });
  opponent.deck.cards.forEach(c => { state.cardNames.push(c.fullName); c.id = cardId++; });

  // Deal hands (7 cards each)
  player.deck.moveTo(player.hand, 7);
  opponent.deck.moveTo(opponent.hand, 7);

  // Put a basic Pokemon as active for each
  const p1Basic = player.hand.cards.find(c => c.superType === 1 && c.stage === 2);
  if (p1Basic) {
    player.hand.moveCardTo(p1Basic, player.active);
  } else {
    // Force first deck card as active if no basic in hand
    player.deck.moveTo(player.active, 1);
  }

  const p2Basic = opponent.hand.cards.find(c => c.superType === 1 && c.stage === 2);
  if (p2Basic) {
    opponent.hand.moveCardTo(p2Basic, opponent.active);
  } else {
    opponent.deck.moveTo(opponent.active, 1);
  }

  // Set prizes
  for (let i = 0; i < 6; i++) {
    player.deck.moveTo(player.prizes[i], 1);
    opponent.deck.moveTo(opponent.prizes[i], 1);
  }

  // Add some cards to discard for Night Stretcher testing
  player.deck.moveTo(player.discard, 3);
  opponent.deck.moveTo(opponent.discard, 3);

  state.players = [player, opponent];
  state.phase = GamePhase.PLAYER_TURN;
  state.turn = 1;
  state.activePlayer = 0;

  return state;
}

// ---- Auto-resolve prompts (like Arbiter does) ----
function autoResolvePrompts(store) {
  let resolved = true;
  let iterations = 0;
  while (resolved && iterations < 20) {
    resolved = false;
    iterations++;
    const unresolved = store.state.prompts.filter(p => p.result === undefined);
    for (const prompt of unresolved) {
      const typeName = prompt.constructor.name || prompt.type;
      let result;

      if (typeName === 'ShuffleDeckPrompt' || prompt.type === 'Shuffle') {
        // Generate a random order
        const player = store.state.players.find(p => p.id === prompt.playerId);
        if (player) {
          const len = player.deck.cards.length;
          result = Array.from({length: len}, (_, i) => i);
        }
      } else if (typeName === 'CoinFlipPrompt' || prompt.type === 'Coin flip') {
        result = true;
      } else if (typeName === 'AlertPrompt' || prompt.type === 'Alert') {
        result = true;
      } else if (typeName === 'ShowCardsPrompt' || prompt.type === 'Show cards') {
        result = true;
      } else if (typeName === 'ConfirmPrompt' || prompt.type === 'Confirm') {
        result = true;
      } else if (typeName === 'ChooseCardsPrompt' || prompt.type === 'Choose cards') {
        // Try selecting the minimum number of valid cards
        const cards = prompt.cards ? prompt.cards.cards : [];
        const min = prompt.options ? prompt.options.min : 0;
        const blocked = prompt.options ? (prompt.options.blocked || []) : [];
        const validIndices = [];
        for (let i = 0; i < cards.length && validIndices.length < min; i++) {
          if (!blocked.includes(i)) {
            validIndices.push(i);
          }
        }
        if (validIndices.length >= min) {
          result = validIndices;
        } else if (prompt.options && prompt.options.allowCancel) {
          result = null; // cancel
        } else {
          result = validIndices;
        }
      } else if (typeName === 'ChoosePokemonPrompt' || prompt.type === 'Choose pokemon') {
        // Select first valid target
        result = [{ player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 }];
      } else if (typeName === 'ChooseEnergyPrompt' || prompt.type === 'Choose energy') {
        result = [];
      } else if (typeName === 'MoveDamagePrompt' || prompt.type === 'Move damage') {
        result = [];
      } else if (typeName === 'PutDamagePrompt' || prompt.type === 'Put damage') {
        result = [];
      } else if (typeName === 'OrderCardsPrompt' || prompt.type === 'Order cards') {
        result = [];
      } else {
        // Unknown prompt type — skip
        console.log(`  [auto-resolve] Unknown prompt: ${typeName} / ${prompt.type}`);
        continue;
      }

      try {
        // Decode result if prompt has a decode method
        if (prompt.decode) {
          result = prompt.decode(result, store.state);
        }
        const action = new ResolvePromptAction(prompt.id, result);
        store.dispatch(action);
        resolved = true;
        break; // restart loop since state changed
      } catch (err) {
        console.log(`  [auto-resolve] Failed to resolve ${typeName}: ${err.message}`);
        // Try canceling
        if (prompt.options && prompt.options.allowCancel) {
          try {
            const cancelAction = new ResolvePromptAction(prompt.id, null);
            store.dispatch(cancelAction);
            resolved = true;
            break;
          } catch (e) {}
        }
      }
    }
  }
  return store.state.prompts.filter(p => p.result === undefined).length;
}

// ---- Main test ----
function runSmokeTest() {
  console.log('=== Card Smoke Test ===\n');

  // Get unique card names from both decks
  const allCardNames = [...new Set([...LUCARDIO_CARDS, ...DRAGAPULT_CARDS])];
  console.log(`Testing ${allCardNames.length} unique cards from both decks\n`);

  const results = { pass: [], fail: [], skip: [] };

  for (const cardName of allCardNames) {
    // Create a fresh game state for each test
    const mockHandler = { onStateChange: () => {} };
    const store = new Store(mockHandler);

    try {
      setupGameState(store, LUCARDIO_CARDS, DRAGAPULT_CARDS);
    } catch (err) {
      console.log(`SETUP ERROR: ${err.message}`);
      return;
    }

    const player = store.state.players[0];
    const card = cardManager.getCardByName(cardName);

    if (!card) {
      console.log(`✗ ${cardName} — NOT FOUND in CardManager`);
      results.fail.push({ name: cardName, error: 'NOT FOUND in CardManager' });
      continue;
    }

    // Determine card type for proper targeting
    const superType = card.superType; // 1=POKEMON, 2=TRAINER, 3=ENERGY
    const stage = card.stage;         // 2=BASIC, ...
    const trainerType = card.trainerType; // 0=ITEM, 1=SUPPORTER, 2=STADIUM, 3=TOOL

    // Inject card into player's hand at index 0
    store.state.cardNames.push(card.fullName);
    card.id = store.state.cardNames.length - 1;
    player.hand.cards.unshift(card);

    // Build target based on card type
    let target;
    if (superType === 3) {
      // Energy → attach to active
      target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    } else if (superType === 1 && stage === 2) {
      // Basic Pokemon → put on bench
      target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BENCH, index: 0 };
      // Make sure bench slot 0 is empty
      player.bench[0] = new PokemonCardList();
      player.bench[0].isPublic = true;
    } else if (superType === 1) {
      // Evolution → put on active (need matching pre-evo)
      target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
    } else if (superType === 2) {
      // Trainer → target depends on trainerType
      if (trainerType === 3) {
        // Tool → attach to active
        target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.ACTIVE, index: 0 };
      } else {
        // Item/Supporter/Stadium → board target
        target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BOARD, index: 0 };
      }
    } else {
      target = { player: PlayerType.BOTTOM_PLAYER, slot: SlotType.BOARD, index: 0 };
    }

    // Dispatch PlayCardAction
    const action = new PlayCardAction(player.id, 0, target);
    try {
      store.dispatch(action);

      // Auto-resolve any prompts that were created
      const remaining = autoResolvePrompts(store);

      if (remaining > 0) {
        console.log(`⚠ ${cardName} — played OK but ${remaining} unresolved prompts remain`);
        results.skip.push({ name: cardName, note: `${remaining} unresolved prompts` });
      } else {
        console.log(`✓ ${cardName}`);
        results.pass.push(cardName);
      }
    } catch (err) {
      const isGameError = err.constructor && err.constructor.name === 'GameError';
      const msg = err.message;

      // Some GameErrors are expected (e.g. CANNOT_PLAY_THIS_CARD for Night Stretcher with empty discard)
      const expectedErrors = [
        'CANNOT_PLAY_THIS_CARD',     // e.g. can't evolve turn 1
        'CANNOT_EVOLVE_THIS_TURN',
        'NOT_ENOUGH_ENERGY',
        'ENERGY_ALREADY_ATTACHED',
        'SUPPORTER_ALREADY_PLAYED',
        'STADIUM_ALREADY_PLAYED',
      ];

      if (isGameError && expectedErrors.includes(msg)) {
        console.log(`~ ${cardName} — expected GameError: ${msg}`);
        results.pass.push(cardName);
      } else if (isGameError) {
        console.log(`✗ ${cardName} — GameError: ${msg}`);
        results.fail.push({ name: cardName, error: `GameError: ${msg}`, stack: '' });
      } else {
        console.log(`✗ ${cardName} — CRASH: ${msg}`);
        console.log(`  Stack: ${(err.stack || '').split('\n').slice(0, 4).join('\n  ')}`);
        results.fail.push({ name: cardName, error: msg, stack: err.stack });
      }
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`✓ Pass: ${results.pass.length}`);
  console.log(`⚠ Warn: ${results.skip.length}`);
  console.log(`✗ Fail: ${results.fail.length}`);

  if (results.fail.length > 0) {
    console.log('\n--- FAILURES ---');
    for (const f of results.fail) {
      console.log(`  ${f.name}: ${f.error}`);
    }
  }
  if (results.skip.length > 0) {
    console.log('\n--- WARNINGS ---');
    for (const s of results.skip) {
      console.log(`  ${s.name}: ${s.note}`);
    }
  }
}

// Suppress the verbose console.log from the logging we added
const origLog = console.log;
const origError = console.error;
let suppressLogs = true;

console.log = function(...args) {
  const msg = args[0];
  if (suppressLogs && typeof msg === 'string' && (
    msg.startsWith('[dispatch]') ||
    msg.startsWith('[store.reduce]') ||
    msg.startsWith('[store.reduceEffect]') ||
    msg.startsWith('[playCardReducer]') ||
    msg.startsWith('[propagateEffect]')
  )) {
    return; // suppress debug logging during smoke test
  }
  origLog.apply(console, args);
};
console.error = function(...args) {
  const msg = args[0];
  if (suppressLogs && typeof msg === 'string' && (
    msg.startsWith('[dispatch]') ||
    msg.startsWith('[store.reduce]') ||
    msg.startsWith('[store.reduceEffect]') ||
    msg.startsWith('[playCardReducer]') ||
    msg.startsWith('[propagateEffect]')
  )) {
    return;
  }
  origError.apply(console, args);
};

runSmokeTest();
