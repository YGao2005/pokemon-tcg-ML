import { TrainerCard } from '../../game/store/card/trainer-card';
import { TrainerType, CardTag } from '../../game/store/card/card-types';
import { StoreLike } from '../../game/store/store-like';
import { State } from '../../game/store/state/state';
import { Effect } from '../../game/store/effects/effect';
import { StateUtils } from '../../game/store/state-utils';
import { GameError } from '../../game/game-error';
import { GameMessage } from '../../game/game-message';
import { UseStadiumEffect } from '../../game/store/effects/game-effects';
import { CheckTableStateEffect } from '../../game/store/effects/check-effects';

export class AreaZeroUnderdepths extends TrainerCard {
  public trainerType: TrainerType = TrainerType.STADIUM;
  public set: string = 'SVI';
  public name: string = 'Area Zero Underdepths';
  public fullName: string = 'Area Zero Underdepths SCR';
  public text: string = 'Each player who has any Tera Pokemon in play can have up to 8 Pokemon on their Bench.';

  public reduceEffect(store: StoreLike, state: State, effect: Effect): State {
    if (effect instanceof CheckTableStateEffect && StateUtils.getStadiumCard(state) === this) {
      // Check if any player has a Tera Pokemon in play
      let anyPlayerHasTera = false;
      for (const player of state.players) {
        let hasTera = false;

        // Check active Pokemon
        const activeCard = player.active.getPokemonCard();
        if (activeCard && activeCard.tags.includes(CardTag.POKEMON_TERA)) {
          hasTera = true;
        }

        // Check bench
        if (!hasTera) {
          for (const bench of player.bench) {
            const benchCard = bench.getPokemonCard();
            if (benchCard && benchCard.tags.includes(CardTag.POKEMON_TERA)) {
              hasTera = true;
              break;
            }
          }
        }

        if (hasTera) {
          anyPlayerHasTera = true;
          break;
        }
      }

      // Expand bench to 8 if any player has Tera Pokemon
      // Note: CheckTableStateEffect.benchSize is global (applies to both players).
      // The engine's handleBenchSizeChange uses a single benchSize value for all
      // players. To properly support per-player bench sizes, the engine would need
      // a per-player bench size check. For now, if ANY player has Tera Pokemon,
      // expand the bench for both players (matching Sky Field's behavior).
      if (anyPlayerHasTera) {
        effect.benchSize = 8;
      }
    }

    if (effect instanceof UseStadiumEffect && StateUtils.getStadiumCard(state) === this) {
      throw new GameError(GameMessage.CANNOT_USE_STADIUM);
    }

    return state;
  }
}
