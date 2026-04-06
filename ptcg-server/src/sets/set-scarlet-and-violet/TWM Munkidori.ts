import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType, PlayerType, SlotType, PokemonCardList, GameMessage, GameError, SpecialCondition } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect, PowerEffect } from '../../game/store/effects/game-effects';
import { AddSpecialConditionsEffect } from '../../game/store/effects/attack-effects';
import { CheckProvidedEnergyEffect } from '../../game/store/effects/check-effects';
import { MoveDamagePrompt } from '../../game/store/prompts/move-damage-prompt';

export class MunkidoriTWM extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.PSYCHIC;
  public hp: number = 110;
  public weakness = [{ type: CardType.DARK }];
  public resistance = [{ type: CardType.FIGHTING, value: -30 }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Adrena-Brain',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, if this Pokemon has any Darkness Energy attached, you may move up to 3 damage counters from 1 of your Pokemon to 1 of your opponent\'s Pokemon.',
  }];

  public attacks = [
    {
      name: 'Mind Bend', cost: [CardType.PSYCHIC, CardType.COLORLESS], damage: 60,
      text: 'Your opponent\'s Active Pokemon is now Confused.'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Munkidori';
  public fullName: string = 'Munkidori TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PowerEffect && effect.power === this.powers[0]) {
      const player = effect.player;
      const cardList = StateUtils.findCardList(state, this) as PokemonCardList;

      // Check for Dark Energy attached
      const checkEnergy = new CheckProvidedEnergyEffect(player, cardList);
      store.reduceEffect(state, checkEnergy);
      let hasDarkEnergy = false;
      checkEnergy.energyMap.forEach(energy => {
        energy.provides.forEach(e => { if (e === CardType.DARK) { hasDarkEnergy = true; } });
      });

      if (!hasDarkEnergy) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // Move up to 3 damage counters from your Pokemon to opponent's Pokemon
      // Simplified: move 30 damage (3 counters)
      return store.prompt(state, new MoveDamagePrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.BOTTOM_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        30,
        { allowCancel: true }
      ), result => {
        // MoveDamagePrompt handles the transfer
      });
    }

    // Mind Bend - Confuse
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const addEffect = new AddSpecialConditionsEffect(effect, [SpecialCondition.CONFUSED]);
      store.reduceEffect(state, addEffect);
    }

    return state;
  }
}
