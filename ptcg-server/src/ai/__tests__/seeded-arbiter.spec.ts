import { SeededArbiter } from '../seeded-arbiter';
import { SeededRNG } from '../seeded-rng';
import { CardList } from '../../game/store/state/card-list';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';
import { CoinFlipPrompt } from '../../game/store/prompts/coin-flip-prompt';
import { Player } from '../../game/store/state/player';
import { State } from '../../game/store/state/state';
import { GameMessage } from '../../game/game-message';

const COIN_FLIP_MSG = GameMessage.COIN_FLIP;

function makeStateWithDeck(deckSize: number, playerId: number = 1): State {
  const state = new State();
  const player = new Player();
  player.id = playerId;
  player.name = 'tester';
  player.deck = new CardList();
  // Push fake card placeholders. The shuffle only cares about deck.cards.length.
  for (let i = 0; i < deckSize; i++) {
    player.deck.cards.push({ id: i } as any);
  }
  state.players = [player];
  return state;
}

describe('SeededArbiter', () => {

  it('Two arbiters constructed with the same seed produce identical 60-card shuffles', () => {
    const arbA = new SeededArbiter(new SeededRNG(42));
    const arbB = new SeededArbiter(new SeededRNG(42));
    const stateA = makeStateWithDeck(60);
    const stateB = makeStateWithDeck(60);
    const promptA = new ShuffleDeckPrompt(1);
    const promptB = new ShuffleDeckPrompt(1);

    const resA = arbA.resolvePrompt(stateA, promptA);
    const resB = arbB.resolvePrompt(stateB, promptB);

    expect(resA).toBeDefined();
    expect(resB).toBeDefined();
    expect(resA!.result).toEqual(resB!.result);
    // The shuffle result must be a permutation: same length, same set of indices.
    expect((resA!.result as number[]).length).toBe(60);
    const sorted = (resA!.result as number[]).slice().sort((a, b) => a - b);
    for (let i = 0; i < 60; i++) {
      expect(sorted[i]).toBe(i);
    }
  });

  it('Different seeds produce different 60-card shuffles', () => {
    const arbA = new SeededArbiter(new SeededRNG(42));
    const arbB = new SeededArbiter(new SeededRNG(43));
    const stateA = makeStateWithDeck(60);
    const stateB = makeStateWithDeck(60);
    const resA = arbA.resolvePrompt(stateA, new ShuffleDeckPrompt(1));
    const resB = arbB.resolvePrompt(stateB, new ShuffleDeckPrompt(1));
    expect(resA!.result).not.toEqual(resB!.result);
  });

  it('Same seed produces identical coin-flip sequence', () => {
    const arbA = new SeededArbiter(new SeededRNG(99));
    const arbB = new SeededArbiter(new SeededRNG(99));
    const stateA = makeStateWithDeck(1);
    const stateB = makeStateWithDeck(1);
    for (let i = 0; i < 50; i++) {
      const resA = arbA.resolvePrompt(stateA, new CoinFlipPrompt(1, COIN_FLIP_MSG));
      const resB = arbB.resolvePrompt(stateB, new CoinFlipPrompt(1, COIN_FLIP_MSG));
      expect(resA!.result).toBe(resB!.result);
    }
  });

  it('Different seeds produce different coin-flip sequences', () => {
    const arbA = new SeededArbiter(new SeededRNG(1));
    const arbB = new SeededArbiter(new SeededRNG(2));
    const stateA = makeStateWithDeck(1);
    const stateB = makeStateWithDeck(1);
    let differs = false;
    for (let i = 0; i < 50; i++) {
      const resA = arbA.resolvePrompt(stateA, new CoinFlipPrompt(1, COIN_FLIP_MSG));
      const resB = arbB.resolvePrompt(stateB, new CoinFlipPrompt(1, COIN_FLIP_MSG));
      if (resA!.result !== resB!.result) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('Coin flips have roughly even distribution over 1000 samples', () => {
    const arb = new SeededArbiter(new SeededRNG(7));
    const state = makeStateWithDeck(1);
    let heads = 0;
    for (let i = 0; i < 1000; i++) {
      const res = arb.resolvePrompt(state, new CoinFlipPrompt(1, COIN_FLIP_MSG));
      if (res!.result === true) heads++;
    }
    // Allow generous slack — this is just a sanity check, not a stats test.
    expect(heads).toBeGreaterThan(400);
    expect(heads).toBeLessThan(600);
  });
});
