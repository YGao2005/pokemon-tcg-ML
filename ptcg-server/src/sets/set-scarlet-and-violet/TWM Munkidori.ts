import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType, PlayerType, SlotType, PokemonCardList, GameMessage, GameError, SpecialCondition } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect, PowerEffect } from '../../game/store/effects/game-effects';
import { AddSpecialConditionsEffect } from '../../game/store/effects/attack-effects';
import { CheckHpEffect, CheckProvidedEnergyEffect } from '../../game/store/effects/check-effects';
import { MoveDamagePrompt, DamageMap } from '../../game/store/prompts/move-damage-prompt';

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

      // Move up to 3 damage counters from one of YOUR Pokemon to one of your
      // OPPONENT's Pokemon. Fixed in Plan 01-05:
      //
      // Old bug: the call passed 8 args to the 6-arg MoveDamagePrompt
      // constructor. The extras were silently dropped, leaving the prompt
      // misconfigured (`playerType=BOTTOM_PLAYER`, `slots=[ACTIVE,BENCH]`,
      // `maxAllowedDamage=PlayerType.TOP_PLAYER as number`). The callback
      // also did nothing — `result =>` was empty, so even if the prompt
      // resolved correctly, no damage moved.
      //
      // Engine constraint: `MoveDamagePrompt` only takes ONE `playerType`
      // slot, not separate from/to. To express "from your side to opponent's
      // side" we use `PlayerType.ANY` and validate the cross-side constraint
      // in the callback. This matches the Banette-GX `Shady Move` pattern
      // (which uses `PlayerType.ANY` for "from any Pokemon to any Pokemon").
      const opponent = StateUtils.getOpponent(state, player);
      const maxAllowedDamage: DamageMap[] = [];
      // Sources: any of player's damaged Pokemon (cap at HP).
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (cl, c, target) => {
        const checkHpEffect = new CheckHpEffect(player, cl);
        store.reduceEffect(state, checkHpEffect);
        maxAllowedDamage.push({ target, damage: checkHpEffect.hp });
      });
      // Destinations: any of opponent's Pokemon (cap at remaining HP).
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cl, c, target) => {
        const checkHpEffect = new CheckHpEffect(opponent, cl);
        store.reduceEffect(state, checkHpEffect);
        maxAllowedDamage.push({ target, damage: checkHpEffect.hp });
      });

      return store.prompt(state, new MoveDamagePrompt(
        player.id,
        GameMessage.MOVE_DAMAGE,
        PlayerType.ANY,
        [SlotType.ACTIVE, SlotType.BENCH],
        maxAllowedDamage,
        { allowCancel: true, min: 0, max: 3 }
      ), transfers => {
        if (transfers === null) {
          return;
        }
        // Apply each 1-counter transfer. Per card text, we enforce the
        // cross-side direction (from yours → to opponent's) here since the
        // prompt's PlayerType.ANY allows any direction.
        for (const transfer of transfers) {
          // Skip same-side transfers — card text says "from your Pokemon TO
          // your opponent's Pokemon". The auto-resolver picks any direction,
          // so we filter here.
          if (transfer.from.player !== PlayerType.BOTTOM_PLAYER ||
              transfer.to.player !== PlayerType.TOP_PLAYER) {
            continue;
          }
          const source = StateUtils.getTarget(state, player, transfer.from);
          const target = StateUtils.getTarget(state, player, transfer.to);
          if (source.damage >= 10) {
            source.damage -= 10;
            target.damage += 10;
          }
        }
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
