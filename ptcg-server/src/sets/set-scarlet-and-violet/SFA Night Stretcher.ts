import { TrainerCard } from '../../game/store/card/trainer-card';
import { TrainerType, SuperType, EnergyType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { GameError, GameMessage, PokemonCard, EnergyCard } from '../../game';
import { Card } from '../../game/store/card/card';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';

function* playCard(next: Function, store: StoreLike, state: State, self: NightStretcher, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;

  const hasPokemon = player.discard.cards.some(c => c instanceof PokemonCard);
  const hasEnergy = player.discard.cards.some(c => c instanceof EnergyCard && c.energyType === EnergyType.BASIC);

  if (!hasPokemon && !hasEnergy) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  effect.preventDefault = true;

  // Choose a Pokemon or basic Energy from discard
  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player.id,
    GameMessage.CHOOSE_CARD_TO_HAND,
    player.discard,
    {},
    {
      min: 1, max: 1, allowCancel: true,
      filter: (card: Card) => {
        return card instanceof PokemonCard ||
          (card instanceof EnergyCard && card.energyType === EnergyType.BASIC);
      }
    }
  ), selected => {
    cards = selected || [];
    next();
  });

  if (cards.length === 0) {
    return state;
  }

  player.hand.moveCardTo(effect.trainerCard, player.discard);
  player.discard.moveCardsTo(cards, player.hand);
  return state;
}

export class NightStretcher extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public set: string = 'SVI';
  public name: string = 'Night Stretcher';
  public fullName: string = 'Night Stretcher SFA';
  public text: string = 'Put a Pokemon or a Basic Energy card from your discard pile into your hand.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, this, effect);
      return generator.next().value;
    }
    return state;
  }
}
