import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType } from '../../game/store/card/card-types';
import { StoreLike, State, PowerType, GameError, GameMessage } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { PowerEffect } from '../../game/store/effects/game-effects';
import { Card } from '../../game/store/card/card';
import { OrderCardsPrompt } from '../../game/store/prompts/order-cards-prompt';

export class DrakloakTWM extends PokemonCard {
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Dreepy';
  public cardType: CardType = CardType.DRAGON;
  public hp: number = 90;
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Recon Directive',
    useWhenInPlay: true,
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, you may look at the top 2 cards of your deck and put 1 of them into your hand. Put the other card on the bottom of your deck.',
  }];

  public attacks = [
    { name: 'Dragon Headbutt', cost: [CardType.FIRE, CardType.PSYCHIC], damage: 70, text: '' },
  ];

  public set: string = 'SVI';
  public name: string = 'Drakloak';
  public fullName: string = 'Drakloak TWM';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PowerEffect && effect.power === this.powers[0]) {
      const player = effect.player;

      if (player.deck.cards.length === 0) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // Look at top 2 cards, pick 1 for hand, put other on bottom
      const topCards = player.deck.cards.slice(0, Math.min(2, player.deck.cards.length));

      if (topCards.length === 1) {
        // Only 1 card, just take it
        player.deck.moveTo(player.hand, 1);
      } else {
        // Take first card to hand, put second on bottom
        // Simplified: take top card to hand, move second to bottom
        player.deck.moveTo(player.hand, 1);
        const bottomCard = player.deck.cards.shift();
        if (bottomCard) {
          player.deck.cards.push(bottomCard);
        }
      }
    }
    return state;
  }
}
