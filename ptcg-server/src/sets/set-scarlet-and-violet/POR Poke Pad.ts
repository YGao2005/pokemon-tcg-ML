import { TrainerCard } from '../../game/store/card/trainer-card';
import { TrainerType, SuperType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { GameError, GameMessage } from '../../game';
import { Card } from '../../game/store/card/card';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';

function* playCard(next: Function, store: StoreLike, state: State, self: PokePad, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;

  const hasSupporterInDiscard = player.discard.cards.some(c =>
    c instanceof TrainerCard && c.trainerType === TrainerType.SUPPORTER
  );

  if (!hasSupporterInDiscard) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  effect.preventDefault = true;

  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player.id,
    GameMessage.CHOOSE_CARD_TO_DECK,
    player.discard,
    { superType: SuperType.TRAINER, trainerType: TrainerType.SUPPORTER },
    { min: 1, max: 1, allowCancel: true }
  ), selected => {
    cards = selected || [];
    next();
  });

  if (cards.length === 0) {
    return state;
  }

  player.hand.moveCardTo(effect.trainerCard, player.discard);

  // Put the Supporter on top of the deck
  player.discard.moveCardsTo(cards, player.deck);
  return state;
}

export class PokePad extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public set: string = 'SVI';
  public name: string = 'Poke Pad';
  public fullName: string = 'Poke Pad POR';
  public text: string = 'Put a Supporter card from your discard pile on top of your deck.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, this, effect);
      return generator.next().value;
    }
    return state;
  }
}
