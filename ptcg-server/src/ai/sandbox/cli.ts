/**
 * Interactive sandbox CLI — manual REPL over Env for human bug-hunting.
 *
 * Purpose: gives a human a way to drive a Dragapult mirror game step by step
 * through the same Env wrapper the AI uses, so that bugs found by manual play
 * are guaranteed to be reproducible by the AI training pipeline. The Angular
 * web UI bypasses Env entirely and would surface a different set of bugs;
 * this CLI is the trustworthy ground truth for "what the AI sees."
 *
 * Commands accepted at the prompt:
 *   <integer>     Pick action index from the printed legal action list,
 *                 dispatch via env.step, print the result.
 *   dump          Write the full state (JSON) to ./sandbox-dump-<ts>.json.
 *   seed N        Reset with a fresh seed.
 *   legal         Reprint the legal action list without advancing.
 *   quit | exit   Clean shutdown.
 *   help | ?      Reprint the command list.
 *
 * Constraint (per plan): no new npm dependencies. We use Node's built-in
 * `readline` and `fs`. No ANSI colors.
 *
 * Constraint (per plan): the CLI must NOT modify any engine state outside of
 * env.step / env.reset.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

import { Env, EnvState, StepResult } from '../env';
import { Action } from '../../game/store/actions/action';
import { PassTurnAction, AttackAction, RetreatAction, UseAbilityAction } from '../../game/store/actions/game-actions';
import { PlayCardAction, PlayerType, SlotType } from '../../game/store/actions/play-card-action';
import { Player } from '../../game/store/state/player';
import { GameWinner } from '../../game/store/state/state';

const HELP_TEXT = `
Sandbox CLI commands
  <int>      Pick action by index from the legal-action list
  legal      Reprint legal actions without advancing
  dump       Write full state to ./sandbox-dump-<timestamp>.json
  seed N     Reset env with fresh seed N
  help       Show this help
  quit       Exit the sandbox
`;

export interface RunSandboxOptions {
  deck: string[];
  initialSeed?: number;
  // Injectable for tests; defaults to process stdin/stdout.
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * Launch the interactive sandbox REPL. Runs until the user types `quit`,
 * the input stream closes (EOF / Ctrl+D), or an unrecoverable error occurs.
 *
 * Returns a Promise that resolves when the REPL exits.
 */
export function runSandbox(options: RunSandboxOptions): Promise<void> {
  const deck = options.deck;
  let seed = options.initialSeed ?? 42;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  const env = new Env();
  let envState: EnvState = env.reset(deck, deck, seed);

  const print = (msg: string) => { output.write(msg + '\n'); };

  const rl = readline.createInterface({
    input,
    output,
    terminal: false,
  });

  const printHeader = () => {
    print('');
    print('=== Pokemon TCG Sandbox (Dragapult mirror) ===');
    print(`Seed: ${seed}`);
    print(HELP_TEXT.trim());
    print('');
  };

  const printState = () => {
    const s = envState.state;
    const active = s.players[s.activePlayer];
    const opponent = s.players[1 - s.activePlayer];

    print('');
    print(`=== Turn ${s.turn} (Player ${s.activePlayer}) ===`);
    print(formatPlayerSummary(active, /* full */ true));
    print(formatPlayerSummary(opponent, /* full */ false));
    const stadiumName = active.stadium.cards[0]?.fullName ?? opponent.stadium.cards[0]?.fullName ?? '-';
    print(`Stadium: ${stadiumName}`);
    if (env.isTerminal(envState)) {
      const w = env.winner(envState);
      const tag = w === 0 ? 'Player 0 wins' : w === 1 ? 'Player 1 wins' : 'Draw';
      print(`*** GAME OVER — ${tag} (winner field: ${GameWinner[s.winner] ?? s.winner}) ***`);
    }
  };

  const printLegalActions = (): Action[] => {
    if (env.isTerminal(envState)) {
      print('(no legal actions — game is terminal)');
      return [];
    }
    const actions = env.legalActions(envState);
    const player = envState.state.players[envState.state.activePlayer];
    print('');
    print('Legal actions:');
    for (let i = 0; i < actions.length; i++) {
      print(`  [${i}] ${formatAction(actions[i], player)}`);
    }
    return actions;
  };

  const handleStepResult = (action: Action, result: StepResult) => {
    if (result.info.crashed) {
      print(`!!! CRASH: ${result.info.error}`);
    } else if (result.info.error) {
      print(`(rejected: ${result.info.error})`);
    } else {
      print(`-> dispatched ${action.constructor.name}` +
            (result.info.promptsResolved ? ` (auto-resolved ${result.info.promptsResolved} prompts)` : ''));
      if (result.done) {
        print(`-> game terminal, reward=${result.reward}`);
      }
    }
    envState = result.state;
  };

  const handleDump = () => {
    const ts = Date.now();
    const filename = `sandbox-dump-${ts}.json`;
    const filepath = path.resolve(process.cwd(), filename);
    try {
      // Strip cycles by JSON-stringify with a circular replacer.
      const json = safeStringify(envState.state);
      fs.writeFileSync(filepath, json);
      print(`Wrote state dump to ${filepath}`);
    } catch (err) {
      print(`Dump failed: ${(err as any).message}`);
    }
  };

  const handleSeed = (arg: string) => {
    const n = parseInt(arg, 10);
    if (!Number.isFinite(n)) {
      print(`Invalid seed: "${arg}"`);
      return;
    }
    seed = n;
    try {
      envState = env.reset(deck, deck, seed);
      print(`Reset with seed ${seed}`);
    } catch (err) {
      print(`Reset failed: ${(err as any).message}`);
    }
  };

  let cachedActions: Action[] = [];

  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (line.length === 0) {
      promptForInput();
      return;
    }
    if (line === 'quit' || line === 'exit') {
      print('Goodbye.');
      rl.close();
      return;
    }
    if (line === 'help' || line === '?') {
      print(HELP_TEXT);
      promptForInput();
      return;
    }
    if (line === 'dump') {
      handleDump();
      promptForInput();
      return;
    }
    if (line === 'legal') {
      cachedActions = printLegalActions();
      promptForInput();
      return;
    }
    if (line.startsWith('seed ')) {
      handleSeed(line.substring(5).trim());
      printState();
      cachedActions = printLegalActions();
      promptForInput();
      return;
    }

    // Try to parse as integer (action index).
    const idx = parseInt(line, 10);
    if (Number.isFinite(idx) && idx >= 0) {
      if (cachedActions.length === 0) {
        cachedActions = env.legalActions(envState);
      }
      if (idx >= cachedActions.length) {
        print(`Index ${idx} out of range (have ${cachedActions.length} actions). Type 'legal' to reprint.`);
        promptForInput();
        return;
      }
      const action = cachedActions[idx];
      const result = env.step(envState, action);
      handleStepResult(action, result);
      printState();
      cachedActions = printLegalActions();
      promptForInput();
      return;
    }

    print(`Unknown command: "${line}". Type 'help' for the command list.`);
    promptForInput();
  };

  const promptForInput = () => {
    output.write('> ');
  };

  return new Promise<void>(resolve => {
    rl.on('line', handleLine);
    rl.on('close', () => resolve());

    printHeader();
    printState();
    cachedActions = printLegalActions();
    promptForInput();
  });
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPlayerSummary(p: Player, full: boolean): string {
  const lines: string[] = [];
  const tag = `P${p.id - 1}`; // P0/P1 — env hard-codes ids 1/2
  const activeCard = p.active.getPokemonCard();
  const activeName = activeCard?.fullName ?? '<none>';
  const activeHpMax = activeCard?.hp ?? 0;
  const activeHpCur = Math.max(0, activeHpMax - p.active.damage);
  const conds = p.active.specialConditions.join(',') || '-';
  lines.push(`${tag} Active: ${activeName} (HP ${activeHpCur} / ${activeHpMax})  cond=${conds}`);

  if (full) {
    const benchSummary = p.bench.map((b, i) => {
      const c = b.getPokemonCard();
      if (c === undefined) return null;
      const cur = Math.max(0, c.hp - b.damage);
      return `[${i}] ${c.fullName} (${cur}/${c.hp})`;
    }).filter(x => x !== null).join(', ') || '(empty)';
    lines.push(`${tag} Bench: ${benchSummary}`);

    const handCount = p.hand.cards.length;
    const handNames = p.hand.cards.map(c => c.fullName ?? '<unknown>').join(', ');
    lines.push(`${tag} Hand (${handCount}): ${handNames}`);

    const prizesLeft = p.getPrizeLeft();
    lines.push(`${tag} Prizes: ${prizesLeft}  Deck: ${p.deck.cards.length}  Discard: ${p.discard.cards.length}`);
  } else {
    const handCount = p.hand.cards.length;
    const benchCount = p.bench.filter(b => b.cards.length > 0).length;
    const prizesLeft = p.getPrizeLeft();
    lines.push(`${tag} Bench=${benchCount}  Hand=${handCount}  Deck=${p.deck.cards.length}  Discard=${p.discard.cards.length}  Prizes=${prizesLeft}`);
  }

  return lines.join('\n');
}

function formatAction(action: Action, player: Player | undefined): string {
  if (action instanceof PassTurnAction) {
    return 'PassTurn';
  }
  if (action instanceof PlayCardAction) {
    const card = player?.hand.cards[action.handIndex];
    const name = card?.fullName ?? '<?>';
    const tgt = formatTarget(action.target);
    return `PlayCard: ${name} (handIdx ${action.handIndex}) -> ${tgt}`;
  }
  if (action instanceof AttackAction) {
    return `Attack: ${action.name}`;
  }
  if (action instanceof UseAbilityAction) {
    const tgt = formatTarget(action.target);
    return `UseAbility: ${action.name} on ${tgt}`;
  }
  if (action instanceof RetreatAction) {
    return `Retreat: bench[${action.benchIndex}]`;
  }
  return action.constructor.name;
}

function formatTarget(t: { player: PlayerType; slot: SlotType; index: number }): string {
  return `${PlayerType[t.player]}/${SlotType[t.slot]}[${t.index}]`;
}

function safeStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  }, 2);
}
