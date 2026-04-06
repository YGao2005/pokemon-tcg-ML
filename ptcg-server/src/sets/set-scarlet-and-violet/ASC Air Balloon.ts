import { TrainerCard } from '../../game/store/card/trainer-card';
import { CardType, TrainerType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { CheckRetreatCostEffect } from '../../game/store/effects/check-effects';

export class AirBalloon extends TrainerCard {
  public trainerType: TrainerType = TrainerType.TOOL;
  public set: string = 'SVI';
  public name: string = 'Air Balloon';
  public fullName: string = 'Air Balloon ASC';
  public text: string = 'The Retreat Cost of the Pokemon this card is attached to is 2 less.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof CheckRetreatCostEffect && effect.player.active.tool === this) {
      // Remove up to 2 Colorless from retreat cost
      for (let i = 0; i < 2; i++) {
        const index = effect.cost.indexOf(CardType.COLORLESS);
        if (index !== -1) {
          effect.cost.splice(index, 1);
        }
      }
    }
    return state;
  }
}
