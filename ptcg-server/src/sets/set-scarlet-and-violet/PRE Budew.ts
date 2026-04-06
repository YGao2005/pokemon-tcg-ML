import { PokemonCard } from '../../game/store/card/pokemon-card';
import { Stage, CardType, GameError, GameMessage, State, StoreLike } from '../../game';
import { Effect } from '../../game/store/effects/effect';
import { AttackEffect } from '../../game/store/effects/game-effects';
import { EndTurnEffect } from '../../game/store/effects/game-phase-effects';
import { PlayItemEffect } from '../../game/store/effects/play-card-effects';

export class BudewPRE extends PokemonCard {
  public stage: Stage = Stage.BASIC;
  public cardType: CardType = CardType.GRASS;
  public hp: number = 30;
  public weakness = [{ type: CardType.FIRE }];
  public retreat = [];

  public attacks = [
    { name: 'Itchy Pollen', cost: [], damage: 10, text: 'During your opponent\'s next turn, they can\'t play any Item cards from their hand.' },
  ];

  public set: string = 'SVI';
  public name: string = 'Budew';
  public fullName: string = 'Budew PRE';

  private readonly ITCHY_POLLEN_MARKER = 'ITCHY_POLLEN_MARKER';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    // Itchy Pollen: place item-lock marker on opponent
    if (effect instanceof AttackEffect && effect.attack === this.attacks[0]) {
      const opponent = effect.opponent;
      opponent.marker.addMarker(this.ITCHY_POLLEN_MARKER, this);
    }

    // Block opponent from playing Item cards while marker is set
    if (effect instanceof PlayItemEffect && effect.player.marker.hasMarker(this.ITCHY_POLLEN_MARKER)) {
      throw new GameError(GameMessage.BLOCKED_BY_EFFECT);
    }

    // Remove marker at the end of each player's turn
    if (effect instanceof EndTurnEffect) {
      effect.player.marker.removeMarker(this.ITCHY_POLLEN_MARKER);
    }

    return state;
  }
}
