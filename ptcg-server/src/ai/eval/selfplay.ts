/**
 * runSelfPlay — random-vs-random self-play harness for Env stress testing.
 *
 * Purpose: drive N games of RandomBot vs RandomBot through Env, count crashes,
 * track per-card coverage, and produce a fully reproducible stats object that
 * downstream tooling (selfplay.spec.ts and run-selfplay.js) can compare across
 * runs.
 *
 * Reward convention (ratified Plan 01-01 design decisions, item 5):
 *   +1 for player-0 (seat A) winner
 *   -1 for player-1 (seat B) winner
 *    0 for draw (turn cap reached) or non-terminal
 * Bots can negate as needed for side-relative reward.
 *
 * Crash semantics (ratified Plan 01-01 design decisions, item 6):
 *   Env.step never throws on engine crashes. Non-GameError crashes surface
 *   via result.info.crashed. The harness counts crashes via info.crashed and
 *   does NOT wrap env.step in try/catch — the only try/catch is the per-game
 *   wrapper that survives unexpected throws from RandomBot itself or from
 *   any pre-step setup.
 *
 * GameError handling: Env.legalActions over-enumerates, so RandomBot will
 * frequently pick actions that the engine rejects with INVALID_TARGET,
 * NOT_ENOUGH_ENERGY, etc. These return info.error (a string) — they're
 * counted in stats.gameErrors, the state is unchanged, and the bot tries
 * again on the next loop iteration. This is intentional; the over-enumeration
 * is by design (see env.ts legalActions docstring).
 *
 * Citation: ByteDance Hearthstone paper (arXiv:2303.05197) §VII.A validates
 * their engine via a similar scripted self-play stress test before training.
 */

import { Env, EnvState } from '../env';
import { SeededRNG } from '../seeded-rng';
import { RandomBot } from '../bots/random';
import { Action } from '../../game/store/actions/action';
import { PlayCardAction } from '../../game/store/actions/play-card-action';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrashRecord {
  gameIndex: number;
  seed: number;
  turn: number;
  error: string;
  stack: string;
}

export interface SelfPlayStats {
  /** Number of games that completed (terminal or hit turn cap). Crashed games
   *  count too — the run still produced data. */
  gamesPlayed: number;
  /** [seat0 wins, seat1 wins]. Only games that reached a real terminal are
   *  counted here. Crashed and turn-capped games go in `crashes` and `draws`. */
  winsBySeat: [number, number];
  /** Games that hit `maxTurnsPerGame` without a terminal. */
  draws: number;
  /** Non-GameError crashes (info.crashed === true). */
  crashes: number;
  /** GameError hits (info.error set, info.crashed unset). Expected to be
   *  large because Env.legalActions over-enumerates. */
  gameErrors: number;
  /** Average completed-turn count across all games (uses state.turn at end). */
  avgTurns: number;
  /** Maximum turn count seen across all games. */
  maxTurns: number;
  /** Total wall time for the run, in milliseconds. */
  wallTimeMs: number;
  /** Per-card play count, keyed by `card.fullName`. Records every successful
   *  PlayCardAction dispatch (NOT including failed attempts). */
  cardPlayCounts: Record<string, number>;
  /** Up to N crash records for diagnostics. The harness keeps all crashes;
   *  callers can truncate when serializing. */
  crashDetails: CrashRecord[];
}

export interface SelfPlayOptions {
  games: number;
  deckA: string[];
  deckB: string[];
  baseSeed: number;
  /** Default 200. Games that exceed this are counted as draws. */
  maxTurnsPerGame?: number;
  /** Default true. When true, even-indexed games run deck A in seat 0 and
   *  deck B in seat 1; odd-indexed games swap. */
  alternateSeats?: boolean;
  /** Default true. When true, the harness temporarily replaces
   *  console.log/console.error with no-op shims for lines that start with
   *  the engine's unconditional error prefixes ([store.reduce*],
   *  [propagateEffect], [env.step]). This is necessary because
   *  Env.legalActions over-enumerates, so the bot will attempt many
   *  illegal actions per game and the engine logs them all unconditionally.
   *  Without suppression, a 1000-game run produces gigabytes of stderr.
   *  The suppression is strictly for the scope of runSelfPlay — original
   *  console methods are restored in the `finally` block even on crash.
   *  Set to false to debug specific failures. */
  suppressEngineLogs?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 200;

/**
 * Run N self-play games and return aggregate stats.
 *
 * Reproducibility: given identical options, two calls produce identical stats
 * (by-value comparison). Verified by selfplay.spec.ts. The RNG seeds for game
 * `i` are derived from `baseSeed + i` (env), `(baseSeed + i) * 2 + 1` (bot 0),
 * and `(baseSeed + i) * 2 + 2` (bot 1) — three independent streams per game.
 */
export function runSelfPlay(options: SelfPlayOptions): SelfPlayStats {
  const {
    games,
    deckA,
    deckB,
    baseSeed,
    maxTurnsPerGame = DEFAULT_MAX_TURNS,
    alternateSeats = true,
    suppressEngineLogs = true,
  } = options;

  const stats: SelfPlayStats = {
    gamesPlayed: 0,
    winsBySeat: [0, 0],
    draws: 0,
    crashes: 0,
    gameErrors: 0,
    avgTurns: 0,
    maxTurns: 0,
    wallTimeMs: 0,
    cardPlayCounts: {},
    crashDetails: [],
  };

  // Engine-log suppression. See SelfPlayOptions.suppressEngineLogs for why.
  // We filter only lines that start with the engine's known unconditional
  // error prefixes — non-engine console output passes through unchanged.
  const origLog = console.log;
  const origErr = console.error;
  const ENGINE_PREFIX_RE = /^\[(store|propagateEffect|env\.step|playCardReducer|dispatch)/;
  if (suppressEngineLogs) {
    const filter = (fn: (...a: any[]) => void) => (...a: any[]) => {
      if (typeof a[0] === 'string' && ENGINE_PREFIX_RE.test(a[0])) return;
      fn.apply(console, a);
    };
    console.log = filter(origLog);
    console.error = filter(origErr);
  }

  const env = new Env();
  const startMs = Date.now();
  let totalTurns = 0;

  try {

  for (let i = 0; i < games; i++) {
    const gameSeed = baseSeed + i;

    // Pick deck assignment.
    const seat0Deck = alternateSeats && (i % 2 === 1) ? deckB : deckA;
    const seat1Deck = alternateSeats && (i % 2 === 1) ? deckA : deckB;

    // Three independent RNG streams per game (env, bot0, bot1). Bots use
    // different seed scaling so changing the game count doesn't accidentally
    // alias a bot's RNG with another game's env.
    const bot0 = new RandomBot(new SeededRNG(gameSeed * 2 + 1));
    const bot1 = new RandomBot(new SeededRNG(gameSeed * 2 + 2));

    let envState: EnvState | undefined;
    let crashedDuringGame = false;
    let crashTurn = 0;
    let crashErr = '';
    let crashStack = '';

    try {
      envState = env.reset(seat0Deck, seat1Deck, gameSeed);
    } catch (err) {
      // A crash inside reset is exceptional — record and move on.
      crashedDuringGame = true;
      crashErr = err && (err as any).message ? (err as any).message : String(err);
      crashStack = err && (err as any).stack ? (err as any).stack : '';
      stats.crashes++;
      stats.crashDetails.push({
        gameIndex: i,
        seed: gameSeed,
        turn: 0,
        error: 'reset: ' + crashErr,
        stack: crashStack,
      });
      stats.gamesPlayed++;
      continue;
    }

    // Game loop.
    let stepCount = 0;
    const stepCap = maxTurnsPerGame * 50; // soft per-step cap (each turn has many micro-actions)
    while (
      envState !== undefined &&
      !env.isTerminal(envState) &&
      envState.state.turn <= maxTurnsPerGame &&
      stepCount < stepCap
    ) {
      stepCount++;
      const seat = env.currentPlayer(envState);
      if (seat === null) break;
      const bot = seat === 0 ? bot0 : bot1;

      let action: Action;
      try {
        action = bot.act(env, envState);
      } catch (err) {
        // Bot crashed (e.g., legalActions returned empty). Record + bail.
        crashedDuringGame = true;
        crashTurn = envState.state.turn;
        crashErr = 'bot.act: ' + (err && (err as any).message ? (err as any).message : String(err));
        crashStack = err && (err as any).stack ? (err as any).stack : '';
        break;
      }

      // Record card play coverage BEFORE dispatch — but only count it after
      // we know the dispatch succeeded (no info.error/info.crashed).
      let attemptedCardName: string | undefined;
      if (action instanceof PlayCardAction) {
        const player = envState.state.players[envState.state.activePlayer];
        if (player !== undefined) {
          const card = player.hand.cards[action.handIndex];
          if (card !== undefined && card.fullName !== undefined) {
            attemptedCardName = card.fullName;
          }
        }
      }

      const result = env.step(envState, action);

      if (result.info.crashed) {
        stats.crashes++;
        crashedDuringGame = true;
        crashTurn = envState.state.turn;
        crashErr = result.info.error ?? 'crash with no error message';
        // Env.step doesn't surface a stack trace through StepInfo; we record
        // the crash error string verbatim. The deeper stack lives in the
        // stderr logs that env.step printed at the moment of the crash.
        crashStack = '(stack in stderr at game ' + i + ' turn ' + envState.state.turn + ')';
        stats.crashDetails.push({
          gameIndex: i,
          seed: gameSeed,
          turn: crashTurn,
          error: crashErr,
          stack: crashStack,
        });
        break;
      }

      if (result.info.error) {
        // GameError — counted but not fatal. Bot retries on next iteration.
        stats.gameErrors++;
      } else if (attemptedCardName !== undefined) {
        // Successful PlayCardAction dispatch — record coverage.
        stats.cardPlayCounts[attemptedCardName] =
          (stats.cardPlayCounts[attemptedCardName] ?? 0) + 1;
      }

      envState = result.state;
    }

    // Tally outcome.
    stats.gamesPlayed++;
    if (envState !== undefined) {
      const finalTurns = envState.state.turn;
      totalTurns += finalTurns;
      if (finalTurns > stats.maxTurns) stats.maxTurns = finalTurns;

      if (!crashedDuringGame) {
        if (env.isTerminal(envState)) {
          const winner = env.winner(envState);
          if (winner === 0) {
            // Map back from seat to deck-relative if needed. We report by
            // SEAT, not by deck — alternateSeats balances assignment so a
            // 50/50 win-rate is the unbiased outcome.
            stats.winsBySeat[0]++;
          } else if (winner === 1) {
            stats.winsBySeat[1]++;
          } else {
            // Draw at terminal (game ended with no winner — rare).
            stats.draws++;
          }
        } else {
          // Hit turn cap or step cap.
          stats.draws++;
        }
      }
    }
  }

  stats.wallTimeMs = Date.now() - startMs;
  stats.avgTurns = stats.gamesPlayed > 0 ? totalTurns / stats.gamesPlayed : 0;

  return stats;

  } finally {
    // Always restore original console methods, even on crash, so future tests
    // or caller code see the normal console.
    if (suppressEngineLogs) {
      console.log = origLog;
      console.error = origErr;
    }
  }
}
