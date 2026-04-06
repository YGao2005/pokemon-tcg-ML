import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';

export class MakuhitaMEG extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.FIGHTING;
  public hp: number = 80;
  public weakness = [{ type: CardType.PSYCHIC }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    { name: 'Corkscrew Punch', cost: [CardType.FIGHTING], damage: 10, text: '' },
    { name: 'Confront', cost: [CardType.FIGHTING, CardType.FIGHTING], damage: 30, text: '' },
  ];

  public set: string = 'SVI';
  public name: string = 'Makuhita';
  public fullName: string = 'Makuhita MEG';
}
