import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType, PlayerType, SlotType, PokemonCardList, GameMessage } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect, PowerEffect } from '../../game/store/effects/game-effects';
import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { PlayPokemonEffect } from '../../game/store/effects/play-card-effects';

export class HariyamaMEG extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Makuhita';
  public cardType: CardType = CardType.FIGHTING;
  public hp: number = 150;
  public weakness = [{ type: CardType.PSYCHIC }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS];

  public powers = [{
    name: 'Heave-Ho Catcher',
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, when you play this Pokemon from your hand to evolve 1 of your Pokemon, you may use this Ability. Switch in 1 of your opponent\'s Benched Pokemon to the Active Spot.',
  }];

  public attacks = [
    {
      name: 'Wild Press', cost: [CardType.FIGHTING, CardType.FIGHTING, CardType.FIGHTING], damage: 210,
      text: 'This Pokemon also does 70 damage to itself.'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Hariyama';
  public fullName: string = 'Hariyama MEG';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Heave-Ho Catcher - triggers on evolution
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const hasBench = opponent.bench.some(b => b.cards.length > 0);

      if (hasBench) {
        // Try to use ability
        try {
          const powerEffect = new PowerEffect(player, this.powers[0], this);
          store.reduceEffect(state, powerEffect);
        } catch {
          return state;
        }

        const generator = this.useHeaveHo(store, state, player, opponent);
        return generator.next().value;
      }
    }

    // Wild Press - self damage
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const player = effect.player;
      player.active.damage += 70;
    }

    return state;
  }

  private *useHeaveHo(store: StoreLike, state: State, player: any, opponent: any): IterableIterator<State> {
    let targets: PokemonCardList[] = [];
    yield store.prompt(state, new ChoosePokemonPrompt(
      player.id,
      GameMessage.CHOOSE_POKEMON_TO_SWITCH,
      PlayerType.TOP_PLAYER,
      [SlotType.BENCH],
      { allowCancel: true }
    ), results => {
      targets = results || [];
    });

    if (targets.length > 0) {
      opponent.switchPokemon(targets[0]);
    }
    return state;
  }
}
