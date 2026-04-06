import { Component, Output, EventEmitter, Input, OnChanges } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { AlertService } from '../../../shared/alert/alert.service';
import { GameService } from '../../../api/services/game.service';
import { LocalGameState } from '../../../shared/session/session.interface';
import { SessionService } from '../../../shared/session/session.service';
import {GamePhase} from 'ptcg-server';

@Component({
  selector: 'ptcg-player-actions',
  templateUrl: './player-actions.component.html',
  styleUrls: ['./player-actions.component.scss']
})
export class PlayerActionsComponent implements OnChanges {

  @Input() gameState: LocalGameState;
  @Input() clientId: number;

  @Output() join = new EventEmitter<void>();

  public isObserver = false;
  public isPlaying = false;
  public isYourTurn = false;
  public isSandbox = false;
  public sandboxPlayerLabel = '';

  constructor(
    private alertService: AlertService,
    private gameService: GameService,
    private sessionService: SessionService,
    private translate: TranslateService
  ) { }

  public async leave() {
    if (!this.gameState || !this.gameState.gameId) {
      return;
    }
    const result = await this.alertService.confirm(
      this.translate.instant('MAIN_LEAVE_GAME')
    );

    if (!result) {
      return;
    }

    if (this.gameState.deleted) {
      this.gameService.removeLocalGameState(this.gameState.localId);
    } else {
      this.gameService.leave(this.gameState.gameId);
    }
  }

  public passTurn() {
    if (!this.gameState || !this.gameState.gameId) {
      return;
    }
    this.gameService.passTurnAction(this.gameState.gameId);
  }

  public switchSides() {
    if (!this.gameState) {
      return;
    }
    const games = this.sessionService.session.gameStates;
    const index = games.findIndex(g => g.localId === this.gameState.localId);
    if (index === -1) {
      return;
    }
    const gameStates = this.sessionService.session.gameStates.slice();
    const switchSide = !this.gameState.switchSide;
    gameStates[index] = {...gameStates[index], switchSide };
    this.sessionService.set({ gameStates });
  }

  public switchPlayer() {
    if (!this.gameState || !this.gameState.sandboxMode) {
      return;
    }
    this.gameService.switchSandboxPlayer(this.gameState.localId);
  }

  ngOnChanges() {
    this.isSandbox = false;
    this.sandboxPlayerLabel = '';

    if (this.gameState && this.clientId) {
      const state = this.gameState.state;
      const activePlayer = state.players[state.activePlayer];

      this.isSandbox = !!this.gameState.sandboxMode;

      if (this.isSandbox) {
        const sandboxId = this.gameState.sandboxActivePlayerId;
        const playerIndex = state.players.findIndex(p => p.id === sandboxId);
        this.sandboxPlayerLabel = playerIndex === 0 ? 'P1' : 'P2';

        // In sandbox mode, you are always "playing"
        this.isPlaying = true;
        this.isObserver = false;
        this.isYourTurn = activePlayer
          && activePlayer.id === sandboxId
          && state.phase === GamePhase.PLAYER_TURN;
      } else {
        this.isYourTurn = activePlayer
          && activePlayer.id === this.clientId
          && state.phase === GamePhase.PLAYER_TURN;

        this.isPlaying = state.players.some(p => p.id === this.clientId);
        const waitingForPlayers = state.players.length < 2;
        const isReplay = !!this.gameState.replay;
        this.isObserver = isReplay || (!this.isPlaying && !waitingForPlayers);
      }
    }
  }

}
