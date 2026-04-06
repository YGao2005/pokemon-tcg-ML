import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, EnergyType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PlayerType, PowerType, GameError, GameMessage, EnergyCard } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { PowerEffect } from '../../game/store/effects/game-effects';
import { Card } from '../../game/store/card/card';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';

export class LunatoneMEG extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.FIGHTING;
  public hp: number = 110;
  public weakness = [{ type: CardType.GRASS }];
  public retreat = [CardType.COLORLESS];

  public powers = [{
    name: 'Lunar Cycle',
    powerType: PowerType.ABILITY,
    text: 'Once during your turn, if you have Solrock in play, you may discard a Basic Fighting Energy card from your hand in order to use this Ability. Draw 3 cards.',
  }];

  public attacks = [
    { name: 'Power Gem', cost: [CardType.FIGHTING, CardType.FIGHTING], damage: 50, text: '' },
  ];

  public set: string = 'SVI';
  public name: string = 'Lunatone';
  public fullName: string = 'Lunatone MEG';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof PowerEffect && effect.power === this.powers[0]) {
      const player = effect.player;

      // Check for Solrock in play
      let hasSolrock = false;
      player.forEachPokemon(PlayerType.BOTTOM_PLAYER, (list, card) => {
        if (card.name === 'Solrock') { hasSolrock = true; }
      });
      if (!hasSolrock) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // Check for Fighting Energy in hand
      const hasFightingEnergy = player.hand.cards.some(c =>
        c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(CardType.FIGHTING)
      );
      if (!hasFightingEnergy) {
        throw new GameError(GameMessage.CANNOT_USE_POWER);
      }

      // Discard a Fighting Energy from hand
      const energyCard = player.hand.cards.find(c =>
        c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(CardType.FIGHTING)
      );
      if (energyCard) {
        player.hand.moveCardTo(energyCard, player.discard);
      }

      // Draw 3 cards
      player.deck.moveTo(player.hand, Math.min(3, player.deck.cards.length));
    }
    return state;
  }
}
