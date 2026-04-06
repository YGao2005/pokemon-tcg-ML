import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, SuperType } from '../../game/store/card/card-types';
import { StoreLike, State, PokemonCardList } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect } from '../../game/store/effects/game-effects';

export class DuskullSFA extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.PSYCHIC;
  public hp: number = 60;
  public weakness = [{ type: CardType.DARK }];
  public resistance = [{ type: CardType.FIGHTING, value: -30 }];
  public retreat = [CardType.COLORLESS];

  public attacks = [
    { name: 'Come and Get You', cost: [CardType.PSYCHIC], damage: 0, text: 'Put up to 3 Duskull from your discard pile onto your Bench.' },
    { name: 'Mumble', cost: [CardType.PSYCHIC, CardType.PSYCHIC], damage: 30, text: '' },
  ];

  public set: string = 'SVI';
  public name: string = 'Duskull';
  public fullName: string = 'Duskull SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const player = effect.player;

      const duskullsInDiscard = player.discard.cards.filter(c =>
        c instanceof PokemonCard && c.name === 'Duskull'
      );

      const emptyBenchSlots = player.bench.filter(b => b.cards.length === 0).length;
      const maxToBench = Math.min(3, duskullsInDiscard.length, emptyBenchSlots);

      for (let i = 0; i < maxToBench; i++) {
        const duskull = player.discard.cards.find(c =>
          c instanceof PokemonCard && c.name === 'Duskull'
        );
        if (duskull) {
          const emptySlot = player.bench.find(b => b.cards.length === 0);
          if (emptySlot) {
            player.discard.moveCardTo(duskull, emptySlot);
            emptySlot.pokemonPlayedTurn = state.turn;
          }
        }
      }
    }
    return state;
  }
}
