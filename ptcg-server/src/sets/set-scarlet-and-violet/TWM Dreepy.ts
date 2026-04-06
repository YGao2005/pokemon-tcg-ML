import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';

export class DreepyTWM extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.DRAGON;
  public hp: number = 70;
  public retreat = [CardType.COLORLESS];

  public attacks = [
    { name: 'Petty Grudge', cost: [CardType.PSYCHIC], damage: 10, text: '' },
    { name: 'Bite', cost: [CardType.FIRE, CardType.PSYCHIC], damage: 40, text: '' },
  ];

  public set: string = 'SVI';
  public name: string = 'Dreepy';
  public fullName: string = 'Dreepy TWM';
}
