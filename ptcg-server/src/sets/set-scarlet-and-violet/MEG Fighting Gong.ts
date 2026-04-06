import { TrainerCard } from '../../game/store/card/trainer-card';
import { TrainerType, SuperType, CardType, EnergyType, Stage } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { GameError, GameMessage, PokemonCard, EnergyCard, StateUtils } from '../../game';
import { Card } from '../../game/store/card/card';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { ShowCardsPrompt } from '../../game/store/prompts/show-cards-prompt';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';

function* playCard(next: Function, store: StoreLike, state: State, self: FightingGong, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  if (player.deck.cards.length === 0) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  effect.preventDefault = true;

  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player.id,
    GameMessage.CHOOSE_CARD_TO_HAND,
    player.deck,
    {},
    {
      min: 1, max: 1, allowCancel: true,
      filter: (card: Card) => {
        return (card instanceof EnergyCard && card.energyType === EnergyType.BASIC && card.provides.includes(CardType.FIGHTING)) ||
          (card instanceof PokemonCard && card.stage === Stage.BASIC && card.cardType === CardType.FIGHTING);
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

  yield store.prompt(state, new ShowCardsPrompt(
    opponent.id,
    GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
    cards
  ), () => next());

  player.deck.moveCardsTo(cards, player.hand);

  return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
    player.deck.applyOrder(order);
  });
}

export class FightingGong extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public set: string = 'SVI';
  public name: string = 'Fighting Gong';
  public fullName: string = 'Fighting Gong MEG';
  public text: string = 'Search your deck for a Basic Fighting Energy card or a Basic Fighting Pokemon, reveal it, and put it into your hand. Then, shuffle your deck.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, this, effect);
      return generator.next().value;
    }
    return state;
  }
}
