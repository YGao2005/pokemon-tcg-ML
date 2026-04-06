import { TrainerCard } from '../../game/store/card/trainer-card';
import { TrainerType, SuperType, Stage } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { GameError, GameMessage, PokemonCard } from '../../game';
import { Card } from '../../game/store/card/card';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';

function* playCard(next: Function, store: StoreLike, state: State, self: BuddyBuddyPoffin, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;

  const emptyBenchSlots = player.bench.filter(b => b.cards.length === 0).length;
  if (emptyBenchSlots === 0) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  const hasValidTargets = player.deck.cards.some(c =>
    c instanceof PokemonCard && c.stage === Stage.BASIC && c.hp <= 70
  );
  if (!hasValidTargets) {
    throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
  }

  effect.preventDefault = true;

  const maxSearch = Math.min(2, emptyBenchSlots);
  let cards: Card[] = [];
  yield store.prompt(state, new ChooseCardsPrompt(
    player.id,
    GameMessage.CHOOSE_CARD_TO_PUT_ONTO_BENCH,
    player.deck,
    { superType: SuperType.POKEMON, stage: Stage.BASIC },
    {
      min: 1, max: maxSearch, allowCancel: true,
      filter: (card: Card) => {
        return card instanceof PokemonCard && card.hp <= 70;
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

  cards.forEach(card => {
    if (card instanceof PokemonCard) {
      const emptySlot = player.bench.find(b => b.cards.length === 0);
      if (emptySlot) {
        player.deck.moveCardTo(card, emptySlot);
        emptySlot.pokemonPlayedTurn = state.turn;
      }
    }
  });

  return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
    player.deck.applyOrder(order);
  });
}

export class BuddyBuddyPoffin extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public set: string = 'SVI';
  public name: string = 'Buddy-Buddy Poffin';
  public fullName: string = 'Buddy-Buddy Poffin TEF';
  public text: string = 'Search your deck for up to 2 Basic Pokemon with 70 HP or less and put them onto your Bench. Then, shuffle your deck.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, this, effect);
      return generator.next().value;
    }
    return state;
  }
}
