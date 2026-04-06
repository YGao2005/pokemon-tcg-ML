import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType, PlayerType, SlotType, PokemonCardList, GameMessage } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { PowerEffect } from '../../game/store/effects/game-effects';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { CheckHpEffect } from '../../game/store/effects/check-effects';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';

export class DusclopsSFA extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Duskull';
  public cardType: CardType = CardType.PSYCHIC;
  public hp: number = 90;
  public weakness = [{ type: CardType.DARK }];
  public resistance = [{ type: CardType.FIGHTING, value: -30 }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public powers = [{
    name: 'Cursed Blast',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may put 5 damage counters on 1 of your opponent\'s Pokemon. If you use this Ability, this Pokemon is Knocked Out.',
  }];

  public attacks = [
    { name: 'Will-O-Wisp', cost: [CardType.PSYCHIC, CardType.PSYCHIC], damage: 50, text: '' },
  ];

  public set: string = 'SVI';
  public name: string = 'Dusclops';
  public fullName: string = 'Dusclops SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PowerEffect && effect.power === this.powers[0]) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Build maxAllowedDamage cap so the prompt can validate target/cap.
      // Fixed in Plan 01-05: previously the constructor was called with
      // `{ allowCancel, min, max }` as `maxAllowedDamage`, leaving `options`
      // undefined. The prompt's validate() method requires the cap to be a
      // proper DamageMap[].
      const maxAllowedDamage: DamageMap[] = [];
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
        const checkHpEffect = new CheckHpEffect(opponent, cardList);
        store.reduceEffect(state, checkHpEffect);
        maxAllowedDamage.push({ target, damage: checkHpEffect.hp });
      });

      // Put 5 damage counters (50 damage) on one of opponent's Pokemon.
      return store.prompt(state, new PutDamagePrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        50,
        maxAllowedDamage,
        { allowCancel: false, min: 1, max: 1 }
      ), targets => {
        // Fixed in Plan 01-05: previously the callback dereferenced
        // `target.target.damage` treating CardTarget as PokemonCardList,
        // silently dropping the 50 damage on the opponent. Canonical fix:
        // resolve the CardTarget via StateUtils.getTarget then mutate the
        // PokemonCardList.damage directly. PowerEffect-based abilities
        // can't use PutCountersEffect (constructor takes an AttackEffect
        // base) so direct mutation matches the chandelure.ts pattern.
        const results = targets || [];
        for (const result of results) {
          const target = StateUtils.getTarget(state, player, result.target);
          target.damage += result.damage;
        }

        // KO this Pokemon (the "If you use this Ability, this Pokemon is
        // Knocked Out" clause from card text).
        const cardList = StateUtils.findCardList(state, this) as PokemonCardList;
        cardList.damage = cardList.cards.reduce((hp, c) => {
          if (c instanceof PokemonCard) { return c.hp; }
          return hp;
        }, 0);
      });
    }
    return state;
  }
}
