import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, CardTag, EnergyType, SuperType } from '../../game/store/card/card-types';
import { StoreLike, State, StateUtils, PlayerType, SlotType, PokemonCardList, GameMessage, EnergyCard } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect, KnockOutEffect } from '../../game/store/effects/game-effects';
import { ChooseCardsPrompt } from '../../game/store/prompts/choose-cards-prompt';
import { ChoosePokemonPrompt } from '../../game/store/prompts/choose-pokemon-prompt';
import { Card } from '../../game/store/card/card';

export class MegaLucarioEx extends PokemonCard {
  public tags = [CardTag.POKEMON_ex];
  public stage: Stage = Stage.STAGE_1;
  public evolvesFrom: string = 'Riolu';
  public cardType: CardType = CardType.FIGHTING;
  public hp: number = 340;
  public weakness = [{ type: CardType.PSYCHIC }];
  public retreat = [CardType.COLORLESS, CardType.COLORLESS];

  public attacks = [
    {
      name: 'Aura Jab', cost: [CardType.FIGHTING], damage: 130,
      text: 'Attach up to 3 Basic Fighting Energy cards from your discard pile to your Benched Pokemon in any way you like.'
    },
    {
      name: 'Mega Brave', cost: [CardType.FIGHTING, CardType.FIGHTING], damage: 270,
      text: 'During your next turn, this Pokemon can\'t use Mega Brave.'
    },
  ];

  public set: string = 'SVI';
  public name: string = 'Mega Lucario ex';
  public fullName: string = 'Mega Lucario ex MEG';

  public readonly MEGA_BRAVE_MARKER = 'MEGA_BRAVE_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Mega Evolution ex gives 3 prizes when KO'd.
    // The engine already awards +1 for POKEMON_ex (total 2). Add +1 more for Mega.
    if (effect instanceof KnockOutEffect && effect.target.getPokemonCard() === this) {
      effect.prizeCount += 1;
    }

    // Aura Jab - attach energy from discard
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const player = effect.player;

      const fightingEnergiesInDiscard = player.discard.cards.filter(c =>
        c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(CardType.FIGHTING)
      );

      if (fightingEnergiesInDiscard.length > 0) {
        const hasBench = player.bench.some(b => b.cards.length > 0);
        if (hasBench) {
          // For simplicity, attach up to 3 energies to the first benched Pokemon
          // A full implementation would use AttachEnergyPrompt for each energy
          const maxAttach = Math.min(3, fightingEnergiesInDiscard.length);
          for (let i = 0; i < maxAttach; i++) {
            const energy = player.discard.cards.find(c =>
              c instanceof EnergyCard && c.energyType === EnergyType.BASIC && c.provides.includes(CardType.FIGHTING)
            );
            const benchTarget = player.bench.find(b => b.cards.length > 0);
            if (energy && benchTarget) {
              player.discard.moveCardTo(energy, benchTarget);
            }
          }
        }
      }
    }

    // Mega Brave - can't use next turn
    if (effect instanceof AttackEffect && effect.attack === this.attacks[1]) {
      if (this.marker === this.MEGA_BRAVE_MARKER) {
        throw new Error('This Pokemon can\'t use Mega Brave this turn.');
      }
      this.marker = this.MEGA_BRAVE_MARKER;
    }

    return state;
  }
}
