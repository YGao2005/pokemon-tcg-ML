import { TrainerCard } from '../../game/store/card/trainer-card';
import { CardType, TrainerType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { TrainerEffect } from '../../game/store/effects/play-card-effects';
import { AttackEffect } from '../../game/store/effects/game-effects';

export class PremiumPowerPro extends TrainerCard {
  public trainerType: TrainerType = TrainerType.ITEM;
  public set: string = 'SVI';
  public name: string = 'Premium Power Pro';
  public fullName: string = 'Premium Power Pro MEG';
  public text: string = 'During this turn, attacks used by your Fighting Pokemon do 30 more damage to your opponent\'s Active Pokemon.';

  // Track which turn this card was played
  private playedOnTurn: number = -1;

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof TrainerEffect && effect.trainerCard === this) {
      this.playedOnTurn = state.turn;
    }

    if (effect instanceof AttackEffect && this.playedOnTurn === state.turn) {
      const player = effect.player;
      const attackingCard = player.active.getPokemonCard();

      // Boost Fighting Pokemon attacks by +30 only during the turn played
      if (attackingCard && attackingCard.cardType === CardType.FIGHTING) {
        if (player.discard.cards.includes(this)) {
          effect.damage += 30;
        }
      }
    }

    return state;
  }
}
