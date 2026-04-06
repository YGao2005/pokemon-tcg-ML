import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect } from '../../game/store/effects/game-effects';

export class RioluMEG extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.FIGHTING;
  public hp: number = 80;
  public weakness = [{ type: CardType.PSYCHIC }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    { name: 'Accelerating Stab', cost: [CardType.FIGHTING], damage: 30, text: 'During your next turn, this Pokemon can\'t use Accelerating Stab.' },
  ];

  public set: string = 'SVI';
  public name: string = 'Riolu';
  public fullName: string = 'Riolu MEG';

  public readonly ATTACK_USED_MARKER = 'ATTACK_USED_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      // Check if marker is set (used last turn)
      if (this.marker === this.ATTACK_USED_MARKER) {
        throw new Error('This Pokemon can\'t use Accelerating Stab this turn.');
      }
      this.marker = this.ATTACK_USED_MARKER;
    }
    return state;
  }
}
