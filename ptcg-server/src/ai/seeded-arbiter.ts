/**
 * SeededArbiter — replaces the engine's default Arbiter so that shuffles and coin
 * flips are routed through a SeededRNG instead of Math.random.
 *
 * The base Arbiter uses Math.random() in two places:
 *   1. shuffle()      — Fisher-Yates-like permutation of deck indices
 *   2. resolvePrompt  — coin flip prompt result via Math.round(Math.random())
 *
 * We override resolvePrompt to capture both: ShuffleDeckPrompt and CoinFlipPrompt.
 *
 * Citation: Hearthstone paper §V audited their engine for Math.random and routed
 * everything through a seedable RNG. We follow the same pattern. See arXiv:2303.05197.
 *
 * Design decision DD2 (Phase 1 plan 01-01).
 */

import { Arbiter } from '../game/core/arbiter';
import { CardList } from '../game/store/state/card-list';
import { CoinFlipPrompt } from '../game/store/prompts/coin-flip-prompt';
import { Prompt } from '../game/store/prompts/prompt';
import { ShuffleDeckPrompt } from '../game/store/prompts/shuffle-prompt';
import { ResolvePromptAction } from '../game/store/actions/resolve-prompt-action';
import { State } from '../game/store/state/state';
import { StateLog } from '../game/store/state/state-log';
import { GameLog } from '../game/game-message';
import { SeededRNG } from './seeded-rng';

export class SeededArbiter extends Arbiter {

  constructor(public rng: SeededRNG) {
    super();
  }

  /**
   * Override the base Arbiter's prompt resolver. We must reimplement the whole
   * method (not super.resolvePrompt) so the shuffle and coin-flip code paths use
   * our SeededRNG instead of Math.random.
   */
  public resolvePrompt(state: State, prompt: Prompt<any>): ResolvePromptAction | undefined {
    const player = state.players.find(p => p.id === prompt.playerId);
    if (player === undefined) {
      return;
    }

    if (prompt instanceof ShuffleDeckPrompt) {
      const result = this.seededShuffle(player.deck);
      return new ResolvePromptAction(prompt.id, result);
    }

    if (prompt instanceof CoinFlipPrompt) {
      const result = this.rng.next() < 0.5;
      const message = result
        ? GameLog.LOG_PLAYER_FLIPS_HEADS
        : GameLog.LOG_PLAYER_FLIPS_TAILS;
      const log = new StateLog(message, { name: player.name });
      return new ResolvePromptAction(prompt.id, result, log);
    }

    return undefined;
  }

  /**
   * Fisher-Yates shuffle using the SeededRNG. Returns an index permutation in the
   * format the engine expects (number[] of original indices, length === deck size).
   *
   * Note: the base Arbiter's shuffle is buggy — it uses
   *   Math.round(Math.random() * len)
   * which biases the endpoints and can leave duplicates. We use a clean Fisher-Yates,
   * which both fixes the bias and respects determinism.
   */
  private seededShuffle(cards: CardList): number[] {
    const len = cards.cards.length;
    const order: number[] = [];
    for (let i = 0; i < len; i++) {
      order.push(i);
    }
    // Standard Fisher-Yates: for i from n-1 down to 1, swap with rng.nextInt(i+1).
    for (let i = len - 1; i > 0; i--) {
      const j = this.rng.nextInt(i + 1);
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }
    return order;
  }
}
