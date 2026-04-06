/**
 * run-selfplay.js — entry script for the random-vs-random self-play harness.
 *
 * Bootstraps the engine card registry (same pattern as start.js / run-sandbox.js),
 * runs N games of RandomBot vs RandomBot on a Dragapult mirror, and prints the
 * full SelfPlayStats as pretty JSON to stdout. Top-5 and bottom-5 cards by
 * play count are printed separately for quick scanning.
 *
 * Exit code: 0 if crashes === 0, 1 otherwise.
 *
 * Usage:
 *   node run-selfplay.js [games] [baseSeed]
 *
 * Defaults: games=1000, baseSeed=42.
 *
 * Note: this is a CRASH-FIND PASS, not the final validation. Crashes here
 * are expected (they feed into Plan 01-03's KNOWN_CARD_BUGS.md). The final
 * validation 1000-game run with all exit criteria enforced happens in 01-06.
 */

require('./config');

const { CardManager } = require('./output/game/cards/card-manager');
const { StateSerializer } = require('./output/game/serializer/state-serializer');
const sets = require('./output/sets');

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

const { runSelfPlay } = require('./output/ai/eval/selfplay');
const { Env } = require('./output/ai/env');
const { DEFAULT_DECKS } = require('./output/backend/services/default-decks');

const dragapult = DEFAULT_DECKS.find(d => d.name === 'Dragapult');
if (!dragapult) {
  console.error('Could not find Dragapult deck in DEFAULT_DECKS');
  process.exit(1);
}

const games = process.argv[2] !== undefined ? parseInt(process.argv[2], 10) : 1000;
const baseSeed = process.argv[3] !== undefined ? parseInt(process.argv[3], 10) : 42;

if (!Number.isFinite(games) || games <= 0) {
  console.error(`Invalid games argument: "${process.argv[2]}"`);
  process.exit(1);
}
if (!Number.isFinite(baseSeed)) {
  console.error(`Invalid baseSeed argument: "${process.argv[3]}"`);
  process.exit(1);
}

console.error(`[run-selfplay] starting ${games} games at baseSeed=${baseSeed}`);
const t0 = Date.now();

const stats = runSelfPlay({
  games,
  deckA: dragapult.cards,
  deckB: dragapult.cards,
  baseSeed,
  maxTurnsPerGame: 80,  // tightened from default 200 — typical games end at ~60 turns
  alternateSeats: true,
});

const wallSec = (Date.now() - t0) / 1000;
console.error(`[run-selfplay] completed in ${wallSec.toFixed(1)}s`);

// Print full stats as JSON to stdout for downstream tooling.
console.log(JSON.stringify(stats, null, 2));

// Print human-readable summary to stderr.
console.error('');
console.error('=== Summary ===');
console.error(`Games played:        ${stats.gamesPlayed}`);
console.error(`Wins by seat:        [${stats.winsBySeat[0]}, ${stats.winsBySeat[1]}]`);
console.error(`Draws (turn cap):    ${stats.draws}`);
console.error(`Crashes (info.crashed): ${stats.crashes}`);
console.error(`GameErrors (illegal): ${stats.gameErrors}`);
console.error(`Avg turns:           ${stats.avgTurns.toFixed(1)}`);
console.error(`Max turns:           ${stats.maxTurns}`);
console.error(`Wall time:           ${(stats.wallTimeMs / 1000).toFixed(1)}s`);
console.error(`Cards observed:      ${Object.keys(stats.cardPlayCounts).length}`);

// Print top-5 and bottom-5 cards by play count.
const cardEntries = Object.entries(stats.cardPlayCounts)
  .sort((a, b) => b[1] - a[1]);

console.error('');
console.error('--- Top 5 cards by play count ---');
for (const [name, count] of cardEntries.slice(0, 5)) {
  console.error(`  ${count.toString().padStart(6)}  ${name}`);
}
console.error('');
console.error('--- Bottom 5 cards by play count (still > 0) ---');
for (const [name, count] of cardEntries.slice(-5)) {
  console.error(`  ${count.toString().padStart(6)}  ${name}`);
}

// Report unique cards in the deck that were NEVER played.
const deckCardNames = new Set(dragapult.cards);
const playedNames = new Set(Object.keys(stats.cardPlayCounts));
const neverPlayed = [];
for (const name of deckCardNames) {
  if (!playedNames.has(name)) neverPlayed.push(name);
}
if (neverPlayed.length > 0) {
  console.error('');
  console.error('--- Cards in deck NEVER played ---');
  for (const name of neverPlayed) {
    console.error(`  ${name}`);
  }
}

// Print observed unknown prompt types from Env (logged on first encounter).
const unknownPrompts = Env.getObservedUnknownPromptTypes ? Env.getObservedUnknownPromptTypes() : [];
if (unknownPrompts.length > 0) {
  console.error('');
  console.error('--- Unknown prompt types encountered ---');
  for (const t of unknownPrompts) console.error(`  ${t}`);
}

// Print up to 10 crash records.
if (stats.crashDetails.length > 0) {
  console.error('');
  console.error('--- Crash details (first 10) ---');
  for (const cr of stats.crashDetails.slice(0, 10)) {
    console.error(`  game ${cr.gameIndex} seed ${cr.seed} turn ${cr.turn}: ${cr.error}`);
  }
}

process.exit(stats.crashes === 0 ? 0 : 1);
