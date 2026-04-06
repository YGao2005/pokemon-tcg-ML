import { TrainerCard } from '../../game/store/card/trainer-card';
import { TrainerType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { GameError, GameMessage, StateUtils } from '../../game';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';

function* playCard(next: Function, store: StoreLike, state: State, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  // Can only be used if opponent has 3 or fewer prize cards remaining
  const opponentPrizes = opponent.prizes.filter(p => p.cards.length > 0).length;
  if (opponentPrizes > 3) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  // Opponent shuffles hand to bottom of deck, then draws 3
  opponent.hand.moveTo(opponent.deck);

  yield store.prompt(state, new ShuffleDeckPrompt(opponent.id), order => {
    opponent.deck.applyOrder(order);
    next();
  });

  opponent.deck.moveTo(opponent.hand, Math.min(3, opponent.deck.cards.length));
  return state;
}

export class SpecialRedCard extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public set: string = 'SVI';
  public name: string = 'Special Red Card';
  public fullName: string = 'Special Red Card M4';
  public text: string = 'You may use this card only if your opponent has 3 or fewer Prize cards remaining. Your opponent shuffles their hand and puts it on the bottom of their deck. Then, they draw 3 cards.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, effect);
      return generator.next().value;
    }
    return state;
  }
}
