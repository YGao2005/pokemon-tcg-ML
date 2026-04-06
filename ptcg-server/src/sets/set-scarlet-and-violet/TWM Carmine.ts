import { TrainerCard } from '../../game/store/card/trainer-card';
import { TrainerType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { GameError, GameMessage } from '../../game';

export class Carmine extends TrainerCard {
  public trainerType: TrainerType = TrainerType.SUPPORTER;
  public set: string = 'SVI';
  public name: string = 'Carmine';
  public fullName: string = 'Carmine TWM';
  public text: string = 'Discard your hand and draw 5 cards.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      const player = effect.player;

      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_PLAY_THIS_CARD);
      }

      // Discard entire hand (except this card which gets discarded by the engine)
      const handCards = player.hand.cards.filter(c => c !== this);
      handCards.forEach(c => {
        player.hand.moveCardTo(c, player.discard);
      });

      // Draw 5 cards
      player.deck.moveTo(player.hand, Math.min(5, player.deck.cards.length));
    }
    return state;
  }
}
