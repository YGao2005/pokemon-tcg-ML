import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PlayerType, GamePhase } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect } from '../../game/store/effects/game-effects';

export class SolrockMEG extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.FIGHTING;
  public hp: number = 110;
  public weakness = [{ type: CardType.GRASS }];
  public retreat = [CardType.COLORLESS];

  public attacks = [
    {
      name: 'Cosmic Beam', cost: [CardType.FIGHTING], damage: 70,
      text: 'If you don\'t have Lunatone on your Bench, this attack does nothing. This attack\'s damage isn\'t affected by Weakness or Resistance.'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Solrock';
  public fullName: string = 'Solrock MEG';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const player = effect.player;

      // Check if Lunatone is on bench
      let hasLunatone = false;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card) => {
        if (card.name === 'Lunatone') {
          hasLunatone = true;
        }
      });

      if (!hasLunatone) {
        effect.damage = 0;
      }

      // Damage isn't affected by Weakness or Resistance
      // This would need to be handled in the damage calculation pipeline
      // by setting flags on the effect
    }
    return state;
  }
}
