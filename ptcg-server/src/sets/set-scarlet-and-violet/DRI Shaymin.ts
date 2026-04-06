import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PlayerType, GamePhase, PokemonCardList } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { PutDamageEffect } from '../../game/store/effects/attack-effects';

export class ShayminDRI extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.GRASS;
  public hp: number = 80;
  public weakness = [{ type: CardType.FIRE }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Flower Curtain',
    powerType: 'ABILITY' as any,
    text: 'Prevent all damage done to your Benched Pokemon that don\'t have a Rule Box by attacks from your opponent\'s Pokemon.',
  }];

  public attacks = [
    { name: 'Smash Kick', cost: [CardType.COLORLESS, CardType.COLORLESS], damage: 30, text: '' },
  ];

  public set: string = 'SVI';
  public name: string = 'Shaymin';
  public fullName: string = 'Shaymin DRI';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Flower Curtain - prevent damage to benched non-Rule Box Pokemon
    if (effect instanceof PutDamageEffect && state.phase === GamePhase.ATTACK) {
      const targetCardList = effect.target;

      // Find which player owns this Shaymin
      const players = [state.players[0], state.players[1]];
      for (const player of players) {
        // Check if Shaymin is in play for this player
        let shayminInPlay = false;
        player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card) => {
          if (card === this) { shayminInPlay = true; }
        });

        if (!shayminInPlay) { continue; }

        // Check if target is one of this player's benched Pokemon
        const isOnBench = player.bench.some(b => b === targetCardList);
        if (!isOnBench) { continue; }

        // Check if target has a Rule Box
        const targetCard = (targetCardList as PokemonCardList).getPokemonCard();
        if (targetCard) {
          const hasRuleBox = targetCard.tags && (
            targetCard.tags.includes(CardTag.POKEMON_ex) ||
            targetCard.tags.includes(CardTag.POKEMON_EX) ||
            targetCard.tags.includes(CardTag.POKEMON_V) ||
            targetCard.tags.includes(CardTag.POKEMON_VMAX) ||
            targetCard.tags.includes(CardTag.POKEMON_VSTAR) ||
            targetCard.tags.includes(CardTag.POKEMON_GX)
          );
          if (!hasRuleBox) {
            effect.damage = 0;
          }
        }
      }
    }
    return state;
  }
}
