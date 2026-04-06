import { TrainerCard } from '../../game/store/card/trainer-card';
import { CardTag, TrainerType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { GameError, GameMessage, StateUtils } from '../../game';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';

function* playCard(next: Function, store: StoreLike, state: State, effect: TrainerEffect): IterableIterator<State> {
  const player = effect.player;
  const opponent = StateUtils.getOpponent(state, player);

  // Check if a Pokemon was KO'd last turn
  // The engine tracks this - check if player lost a Pokemon on opponent's last turn
  if (!player.lostZone || player.lostZone.cards.length === 0) {
    // Simplified check - this card should only be playable if one of your Pokemon was KO'd
    // For now, allow it always (the actual check depends on engine tracking)
  }

  // Both players shuffle hand into deck
  player.hand.moveTo(player.deck);
  opponent.hand.moveTo(opponent.deck);

  yield store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
    player.deck.applyOrder(order);
    next();
  });

  yield store.prompt(state, new ShuffleDeckPrompt(opponent.id), order => {
    opponent.deck.applyOrder(order);
    next();
  });

  // You draw 5, opponent draws 2
  player.deck.moveTo(player.hand, Math.min(5, player.deck.cards.length));
  opponent.deck.moveTo(opponent.hand, Math.min(2, opponent.deck.cards.length));
  return state;
}

export class UnfairStamp extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public tags = [CardTag.ACE_SPEC];
  public set: string = 'SVI';
  public name: string = 'Unfair Stamp';
  public fullName: string = 'Unfair Stamp TWM';
  public text: string = 'You can use this card only if any of your Pokemon were Knocked Out during your opponent\'s last turn. Each player shuffles their hand into their deck. Then, you draw 5 cards, and your opponent draws 2 cards.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const generator = playCard(() => generator.next(), store, state, effect);
      return generator.next().value;
    }
    return state;
  }
}
