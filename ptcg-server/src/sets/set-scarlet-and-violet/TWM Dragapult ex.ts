import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PlayerType, SlotType, PokemonCardList, GameMessage, GamePhase } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect } from '../../game/store/effects/game-effects';
import { PutDamageEffect, PutCountersEffect } from '../../game/store/effects/attack-effects';
import { PutDamagePrompt } from '../../game/store/prompts/put-damage-prompt';
import { CheckHpEffect } from '../../game/store/effects/check-effects';
import { DamageMap } from '../../game/store/prompts/move-damage-prompt';

export class DragapultEx extends PokemonCard {
  public tags = [CardTag.POKEMON_ex, CardTag.POKEMON_TERA];
  public stage: Stage = Stage.STAGE_2;
  public evolvesFrom: string = 'Drakloak';
  public cardType: CardType = CardType.DRAGON;
  public hp: number = 320;
  public retreat = [CardType.COLORLESS];

  public attacks = [
    { name: 'Jet Headbutt', cost: [CardType.COLORLESS], damage: 70, text: '' },
    {
      name: 'Phantom Dive', cost: [CardType.FIRE, CardType.PSYCHIC], damage: 200,
      text: 'Put 6 damage counters on your opponent\'s Benched Pokemon in any way you like.'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Dragapult ex';
  public fullName: string = 'Dragapult ex TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Tera rule: prevent damage when on bench
    if (effect instanceof PutDamageEffect && effect.target) {
      const player = effect.player;
      const cardList = StateUtils.findCardList(state, this) as PokemonCardList;

      // If this card is on the bench and being targeted by damage
      if (effect.target === cardList && state.phase === GamePhase.ATTACK) {
        const isOnBench = player.bench.some(b => b === cardList) ||
          StateUtils.getOpponent(state, player).bench.some(b => b === cardList);
        if (isOnBench) {
          effect.damage = 0;
          return state;
        }
      }
    }

    // Phantom Dive - 200 damage to active + put 6 damage counters (60 damage)
    // on opponent's benched Pokemon. The base 200 damage flows through the
    // normal attack damage path; we only add the spread here.
    //
    // Fixed in Plan 01-05: previously the callback dereferenced
    // `target.target.damage += target.damage` treating CardTarget as a
    // PokemonCardList — silently dropping the spread damage. Canonical fix
    // pattern from `set-black-and-white-3/lampent.ts`: resolve the CardTarget
    // via StateUtils.getTarget, then dispatch a PutCountersEffect that the
    // engine routes through the normal damage pipeline (so weakness/protect
    // markers etc. apply correctly to the spread).
    if (effect instanceof AttackEffect && effect.attack === this.attacks[1]) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);
      const hasBench = opponent.bench.some(b => b.cards.length > 0);

      if (hasBench) {
        // Build the maxAllowedDamage cap so the prompt's validate() can verify
        // each chosen target. Without this, the constructor was being called
        // with options-as-maxAllowedDamage and validation passed nothing.
        const maxAllowedDamage: DamageMap[] = [];
        opponent.forEachPokemon(PlayerType.TOP_PLAYER, (cardList, card, target) => {
          if (target.slot !== SlotType.BENCH) return;
          const checkHpEffect = new CheckHpEffect(opponent, cardList);
          store.reduceEffect(state, checkHpEffect);
          maxAllowedDamage.push({ target, damage: checkHpEffect.hp });
        });

        // Put 6 damage counters (60 damage) on opponent's bench in any way.
        return store.prompt(state, new PutDamagePrompt(
          player.id,
          GameMessage.CHOOSE_POKEMON_TO_DAMAGE,
          PlayerType.TOP_PLAYER,
          [SlotType.BENCH],
          60,
          maxAllowedDamage,
          { allowCancel: false }
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
    }

    return state;
  }
}
