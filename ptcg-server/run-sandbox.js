/**
 * run-sandbox.js — entry script for the interactive sandbox CLI.
 *
 * Bootstraps the engine card registry (same pattern as start.js) and then
 * launches the runSandbox REPL on a Dragapult mirror. The REPL uses the
 * same Env wrapper the AI uses, so any bug found here is reproducible in
 * the AI training pipeline.
 *
 * Usage:
 *   node run-sandbox.js [seed]
 */

require('./config');

const { CardManager } = require('./output/game/cards/card-manager');
const { StateSerializer } = require('./output/game/serializer/state-serializer');
const sets = require('./output/sets');

// Bootstrap card sets — without this, card lookups by name fail in
// AddPlayerAction (Engine error: UNKNOWN_CARD).
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

const { runSandbox } = require('./output/ai/sandbox/cli');
const { DEFAULT_DECKS } = require('./output/backend/services/default-decks');

const dragapult = DEFAULT_DECKS.find(d => d.name === 'Dragapult');
if (!dragapult) {
  console.error('Could not find Dragapult deck in DEFAULT_DECKS');
  process.exit(1);
}

const seedArg = process.argv[2];
const initialSeed = seedArg !== undefined ? parseInt(seedArg, 10) : 42;

if (!Number.isFinite(initialSeed)) {
  console.error(`Invalid seed argument: "${seedArg}"`);
  process.exit(1);
}

runSandbox({
  deck: dragapult.cards,
  initialSeed,
}).then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Sandbox crashed:', err);
  process.exit(1);
});
