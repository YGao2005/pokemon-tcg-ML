import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, SuperType, TrainerType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PowerType, GameMessage, GameError } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect, PowerEffect } from '../../game/store/effects/game-effects';
import { PlayPokemonEffect } from '../../game/store/effects/play-card-effects';
import { TrainerCard } from '../../game/store/card/trainer-card';
import { Card } from '../../game/store/card/card';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { ShowCardsPrompt } from '../../game/store/prompts/show-cards-prompt';
import { ShuffleDeckPrompt } from '../../game/store/prompts/shuffle-prompt';

export class MeowthEx extends PokemonCard {
  public tags = [CardTag.POKEMON_ex];
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.COLORLESS;
  public hp: number = 170;
  public weakness = [{ type: CardType.FIGHTING }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    // Triggered automatically on play (PlayPokemonEffect handler) — does NOT
    // need useWhenInPlay since the player never invokes it via UseAbilityAction.
    name: 'Last-Ditch Catch',
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, when you play this Pokemon from your hand onto your Bench, you may use this Ability. Search your deck for a Supporter card, reveal it, and put it into your hand. Then, shuffle your deck.',
  }];

  public attacks = [
    {
      name: 'Tuck Tail', cost: [CardType.COLORLESS, CardType.COLORLESS, CardType.COLORLESS], damage: 60,
      text: 'Put this Pokemon and all attached cards into your hand.'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Meowth ex';
  public fullName: string = 'Meowth ex POR';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Last-Ditch Catch - when played to bench
    if (effect instanceof PlayPokemonEffect && effect.pokemonCard === this) {
      const player = effect.player;
      const opponent = StateUtils.getOpponent(state, player);

      try {
        const powerEffect = new PowerEffect(player, this.powers[0], this);
        store.reduceEffect(state, powerEffect);
      } catch {
        return state;
      }

      if (player.deck.cards.length === 0) {
        return state;
      }

      const generator = this.searchSupporter(store, state, player, opponent);
      return generator.next().value;
    }

    // Tuck Tail - return to hand
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const player = effect.player;
      // Move all cards from active slot to hand
      player.active.moveTo(player.hand);
      player.active.clearEffects();
    }

    return state;
  }

  private *searchSupporter(store: StoreLike, state: State, player: any, opponent: any): IterableIterator<State> {
    let cards: Card[] = [];
    yield store.prompt(state, new ChooseCardsPrompt(
      player.id,
      GameMessage.CHOOSE_CARD_TO_HAND,
      player.deck,
      { superType: SuperType.TRAINER, trainerType: TrainerType.SUPPORTER },
      { min: 0, max: 1, allowCancel: true }
    ), selected => {
      cards = selected || [];
    });

    if (cards.length > 0) {
      yield store.prompt(state, new ShowCardsPrompt(
        opponent.id,
        GameMessage.CARDS_SHOWED_BY_THE_OPPONENT,
        cards
      ), () => {});

      player.deck.moveCardsTo(cards, player.hand);
    }

    return store.prompt(state, new ShuffleDeckPrompt(player.id), order => {
      player.deck.applyOrder(order);
    });
  }
}
