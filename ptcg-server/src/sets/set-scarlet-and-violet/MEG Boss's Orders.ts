import { TrainerCard } from '../../game/store/card/trainer-card';
import { TrainerType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { PlayerType, SlotType, GameError, GameMessage, PokemonCardList, StateUtils } from '../../game';
import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';

function* playCard(next: Function, store: StoreLike, state: State, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);
  const hasBench = opponent.bench.some(b => b.cards.length > 0);

  if (hasBench === false) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  effect.preventDefault = true;

  let targets: PokemonCardList[] = [];
  yield store.prompt(state, new ChoosePokemonPrompt(
    player.id,
    GameMessage.CHOOSE_POKEMON_TO_SWITCH,
    PlayerType.TOP_PLAYER,
    [SlotType.BENCH],
    { allowCancel: true }
  ), results => {
    targets = results || [];
    next();
  });

  if (targets.length === 0) {
    return state;
  }

  // Move to supporter zone, NOT discard. End-of-turn cleanup
  // (game-phase-effect.ts) moves supporter → discard, so the final resting
  // place is the same. The mid-turn placement matters for the one-Supporter-
  // per-turn rule: play-card-reducer.ts line 90 checks
  // `player.supporter.cards.length > 0` to reject subsequent supporters, and
  // moving straight to discard bypassed this check (multi-Boss's-Orders
  // loophole). Fix discovered by Plan 01-06 L6 cross-card interaction tests.
  player.hand.moveCardTo(effect.trainerCard, player.supporter);
  opponent.switchPokemon(targets[0]);
  return state;
}

export class BosssOrdersMEG extends TrainerCard {
  public trainerType: TrainerType = TrainerType.SUPPORTER;
  public set: string = 'SVI';
  public name: string = 'Boss\'s Orders';
  public fullName: string = 'Boss\'s Orders MEG';
  public text: string = 'Switch in 1 of your opponent\'s Benched Pokemon to the Active Spot.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, effect);
      return generator.next().value;
    }
    return state;
  }
}
