import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType, PlayerType, SlotType, PokemonCardList, GameMessage } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect, PowerEffect } from '../../game/store/effects/game-effects';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { PutCountersEffect } from '../../game/store/effects/attack-effects';
import { CheckHpEffect } from '../../game/store/effects/check-effects';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';

export class FezandipitiExSFA extends PokemonCard {
  public tags = [CardTag.POKEMON_ex];
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.DARK;
  public hp: number = 210;
  public weakness = [{ type: CardType.FIGHTING }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Flip the Script',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, if any of your Pokemon were Knocked Out during your opponent\'s last turn, you may draw 3 cards.',
  }];

  public attacks = [
    {
      name: 'Cruel Arrow', cost: [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS], damage: 0,
      text: 'This attack does 100 damage to 1 of your opponent\'s Pokemon.'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Fezandipiti ex';
  public fullName: string = 'Fezandipiti ex SFA';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Flip the Script
    if (effect instanceof PowerEffect && effect.power === this.powers[0]) {
      const player = effect.player;
      // Draw 3 cards (KO check is simplified - ideally we'd check last turn's KOs)
      player.deck.moveTo(player.hand, Math.min(3, player.deck.cards.length));
    }

    // Cruel Arrow - 100 damage to one of opponent's Pokemon (any).
    // Fixed in Plan 01-05: same root cause as Phantom Dive — constructor
    // signature mismatch and callback dereference bug. Now resolves the
    // CardTarget via StateUtils.getTarget and dispatches PutCountersEffect
    // through the engine pipeline.
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      const maxAllowedDamage: DamageMap[] = [];
      opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
        const checkHpEffect = new CheckHpEffect(opponent, cardList);
        store.reduceEffect(state, checkHpEffect);
        maxAllowedDamage.push({ target, damage: checkHpEffect.hp });
      });

      return store.prompt(state, new PutDamagePrompt(
        player.id,
        GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
        PlayerType.TOP_PLAYER,
        [SlotType.ACTIVE, SlotType.BENCH],
        100,
        maxAllowedDamage,
        { allowCancel: false, min: 1, max: 1 }
      ), targets => {
        const results = targets || [];
        for (const result of results) {
          const target = StateUtils.getTarget(state, player, result.target);
          const putCountersEffect = new PutCountersEffect(effect, result.damage);
          putCountersEffect.target = target;
          store.reduceEffect(state, putCountersEffect);
        }
      });
    }

    return state;
  }
}
