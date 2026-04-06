import { TrainerCard } from '../../game/store/card/trainer-card';
import { CardType, TrainerType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { PowerEffect } from '../../game/store/effects/game-effects';
import { StateUtils, PokemonCard, GameError, GameMessage } from '../../game';

export class TeamRocketsWatchtower extends TrainerCard {
  public trainerType: TrainerType = TrainerType.STADIUM;
  public set: string = 'SVI';
  public name: string = 'Team Rocket\'s Watchtower';
  public fullName: string = 'Team Rocket\'s Watchtower DRI';
  public text: string = 'Colorless Pokemon in play (both yours and your opponent\'s) have no Abilities.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PowerEffect && StateUtils.getStadiumCard(state) === this) {
      const pokemonCard = effect.card;
      if (pokemonCard instanceof PokemonCard && pokemonCard.cardType === CardType.COLORLESS) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }
    }
    return state;
  }
}
