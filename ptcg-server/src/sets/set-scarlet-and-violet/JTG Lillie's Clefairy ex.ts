import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect, PowerEffect } from '../../game/store/effects/game-effects';
import { CheckPokemonStatsEffect } from '../../game/store/effects/check-effects';

export class LilliesClefairyEx extends PokemonCard {
  public tags = [CardTag.POKEMON_ex, CardTag.LILLIES];
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.PSYCHIC;
  public hp: number = 190;
  public weakness = [{ type: CardType.METAL }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Fairy Zone',
    powerType: PowerType.ABILITY,
    text: 'The Weakness of each of your opponent\'s Dragon Pokemon in play is now Psychic.',
  }];

  public attacks = [
    {
      name: 'Full Moon Rondo', cost: [CardType.PSYCHIC, CardType.COLORLESS], damage: 20,
      text: 'This attack does 20 more damage for each Benched Pokemon (both yours and your opponent\'s).'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Lillie\'s Clefairy ex';
  public fullName: string = 'Lillie\'s Clefairy ex JTG';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Full Moon Rondo
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      let benchCount = 0;
      benchCount += player.bench.filter(b => b.cards.length > 0).length;
      benchCount += opponent.bench.filter(b => b.cards.length > 0).length;

      effect.damage = 20 + (20 * benchCount);
    }

    // Fairy Zone: override weakness of opponent's Dragon Pokemon to Psychic
    if (effect instanceof CheckPokemonStatsEffect) {
      const targetCard = effect.target.getPokemonCard();

      // Only apply to Dragon-type Pokemon
      if (targetCard && targetCard.cardType === CardType.DRAGON) {
        // Find the player who owns this Clefairy ex
        for (const player of state.players) {
          const opponent = StateUtils.getOpponent(state, player);

          // Check if the target belongs to the opponent
          let targetBelongsToOpponent = false;
          if (opponent.active === effect.target) {
            targetBelongsToOpponent = true;
          }
          if (!targetBelongsToOpponent) {
            for (const bench of opponent.bench) {
              if (bench === effect.target) {
                targetBelongsToOpponent = true;
                break;
              }
            }
          }

          if (!targetBelongsToOpponent) {
            continue;
          }

          // Check if this Clefairy ex is in play for this player
          let isInPlay = false;
          if (player.active.getPokemonCard() === this) {
            isInPlay = true;
          }
          if (!isInPlay) {
            for (const bench of player.bench) {
              if (bench.getPokemonCard() === this) {
                isInPlay = true;
                break;
              }
            }
          }

          if (!isInPlay) {
            continue;
          }

          // Verify the ability isn't locked
          try {
            const powerEffect = new PowerEffect(player, this.powers[0], this);
            store.reduceEffect(state, powerEffect);
          } catch {
            continue;
          }

          // Override the Dragon Pokemon's weakness to Psychic
          effect.weakness = [{ type: CardType.PSYCHIC }];
          break;
        }
      }
    }

    return state;
  }
}
