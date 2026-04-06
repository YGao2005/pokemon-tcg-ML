import { TrainerCard } from '../../game/store/card/trainer-card';
import { CardTag, TrainerType } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect } from '../../game/store/effects/game-effects';
import { StateUtils, PokemonCard, PokemonCardList } from '../../game';

export class MaximumBelt extends TrainerCard {
  public trainerType: TrainerType = TrainerType.TOOL;
  public tags = [CardTag.ACE_SPEC];
  public set: string = 'SVI';
  public name: string = 'Maximum Belt';
  public fullName: string = 'Maximum Belt TEF';
  public text: string = 'Attacks used by the Pokemon this card is attached to do 50 more damage to your opponent\'s Active Pokemon ex.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AttackEffect) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Check if the attacking Pokemon has this tool attached
      const attackingPokemon = player.active;
      if (attackingPokemon.tool !== this) {
        return state;
      }

      // Check if defending Pokemon is an ex
      const defendingCard = opponent.active.getPokemonCard();
      if (defendingCard && defendingCard.tags && defendingCard.tags.includes(CardTag.POKEMON_ex)) {
        effect.damage += 50;
      }
    }
    return state;
  }
}
