import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType, PlayerType, SlotType, PokemonCardList, GameMessage } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect, PowerEffect } from '../../game/store/effects/game-effects';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { CheckHpEffect } from '../../game/store/effects/check-effects';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';

export class DusknoirPRE extends PokemonCard {
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Dusclops';
  public cardType: CardType = CardType.PSYCHIC;
  public hp: number = 160;
  public weakness = [{ type: CardType.DARK }];
  public resistance = [{ type: CardType.FIGHTING, value: -30 }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS];

  public powers = [{
    name: 'Cursed Blast',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may put 13 damage counters on 1 of your opponent\'s Pokemon. If you use this Ability, this Pokemon is Knocked Out.',
  }];

  public attacks = [
    {
      name: 'Shadow Bind', cost: [CardType.PSYCHIC, CardType.PSYCHIC, CardType.COLORLESS], damage: 150,
      text: 'During your opponent\'s next turn, the Defending Pokemon can\'t retreat.'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Dusknoir';
  public fullName: string = 'Dusknoir PRE';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PowerEffect && effect.power === this.powers[0]) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      // Build maxAllowedDamage cap. Fixed in Plan 01-05 — same root cause
      // as Dusclops Cursed Blast. See SFA Dusclops.ts for full notes.
      const maxAllowedDamage: DamageMap[] = [];
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
        const checkHpEffect = new CheckHpEffect(opponent, cardList);
        store.reduceEffect(state, checkHpEffect);
        maxAllowedDamage.push({ target, damage: checkHpEffect.hp });
      });

      // Put 13 damage counters (130 damage) on one of opponent's Pokemon.
      return store.prompt(state, new PutDamagePrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        130,
        maxAllowedDamage,
        { allowCancel: false, min: 1, max: 1 }
      ), targets => {
        // Fixed in Plan 01-05: resolve CardTarget → PokemonCardList via
        // StateUtils.getTarget then mutate damage directly. Mirrors the
        // chandelure.ts canonical pattern for PowerEffect-based abilities.
        const results = targets || [];
        for (const result of results) {
          const target = StateUtils.getTarget(state, player, result.target);
          target.damage += result.damage;
        }

        // KO this Pokemon (per card text "If you use this Ability, this
        // Pokemon is Knocked Out").
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
