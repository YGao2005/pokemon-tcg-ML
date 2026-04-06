import { Component, OnInit } from '@angular/core';
import { GameInfo, ClientInfo } from 'ptcg-server';
import { MatDialog } from '@angular/material/dialog';
import { Observable, EMPTY, from } from 'rxjs';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { finalize, switchMap, map } from 'rxjs/operators';

import { AlertService } from '../shared/alert/alert.service';
import { ApiError } from '../api/api.error';
import { ClientUserData } from '../api/interfaces/main.interface';
import { CreateGamePopupComponent, CreateGamePopupResult } from './create-game-popup/create-game-popup.component';
import { SandboxPopupComponent, SandboxPopupResult } from './sandbox-popup/sandbox-popup.component';
import { DeckService } from '../api/services/deck.service';
import { MainService } from '../api/services/main.service';
import { SelectPopupOption } from '../shared/alert/select-popup/select-popup.component';
import { SessionService } from '../shared/session/session.service';
import { UserInfoMap } from '../shared/session/session.interface';

@UntilDestroy()
@Component({
  selector: 'ptcg-games',
  templateUrl: './games.component.html',
  styleUrls: ['./games.component.scss']
})
export class GamesComponent implements OnInit {
  title = 'ptcg-play';

  displayedColumns: string[] = ['id', 'turn', 'player1', 'player2', 'actions'];
  public clients$: Observable<ClientUserData[]>;
  public games$: Observable<GameInfo[]>;
  public loading = false;
  public clientId: number;
  public loggedUserId: number;

  constructor(
    private alertService: AlertService,
    private deckService: DeckService,
    private dialog: MatDialog,
    private mainSevice: MainService,
    private router: Router,
    private sessionService: SessionService,
    private translate: TranslateService
  ) {
    this.clients$ = this.sessionService.get(
      session => session.users,
      session => session.clients
    ).pipe(map(([users, clients]: [UserInfoMap, ClientInfo[]]) => {
      const values = clients.map(c => ({
        clientId: c.clientId,
        user: users[c.userId]
      }));
      values.sort((client1, client2) => {
        return client2.user.ranking - client1.user.ranking;
      });
      return values;
    }));

    this.games$ = this.sessionService.get(session => session.games);
  }

  ngOnInit() {
    this.sessionService.get(session => session.clientId)
      .pipe(untilDestroyed(this))
      .subscribe(clientId => { this.clientId = clientId; });

    this.sessionService.get(session => session.loggedUserId)
      .pipe(untilDestroyed(this))
      .subscribe(loggedUserId => { this.loggedUserId = loggedUserId; });

  }

  private showCreateGamePopup(decks: SelectPopupOption<number>[]): Promise<CreateGamePopupResult> {
    const dialog = this.dialog.open(CreateGamePopupComponent, {
      maxWidth: '100%',
      width: '350px',
      data: { decks }
    });
    return dialog.afterClosed().toPromise();
  }

  private showSandboxPopup(decks: SelectPopupOption<number>[]): Promise<SandboxPopupResult> {
    const dialog = this.dialog.open(SandboxPopupComponent, {
      maxWidth: '100%',
      width: '350px',
      data: { decks }
    });
    return dialog.afterClosed().toPromise();
  }

  public createGame(invitedId?: number) {
    this.loading = true;
    this.deckService.getList()
      .pipe(
        finalize(() => { this.loading = false; }),
        untilDestroyed(this),
        switchMap(decks => {
          const options = decks.decks
            .filter(deckEntry => deckEntry.isValid)
            .map(deckEntry => ({value: deckEntry.id, viewValue: deckEntry.name}));

          if (options.length === 0) {
            this.alertService.alert(
              this.translate.instant('GAMES_NEED_DECK'),
              this.translate.instant('GAMES_NEED_DECK_TITLE')
            );
            return EMPTY;
          }

          return from(this.showCreateGamePopup(options));
        }),
        switchMap(result => {
          this.loading = true;
          return result !== undefined
            ? this.deckService.getDeck(result.deckId).pipe(map(deckResult => ({
              deck: deckResult.deck.cards,
              gameSettings: result.gameSettings
            })))
            : EMPTY;
        }),
        switchMap(data => {
          return this.mainSevice.createGame(data.deck, data.gameSettings, invitedId);
        }),
        finalize(() => { this.loading = false; })
      )
      .subscribe({
        next: () => {},
        error: (error: ApiError) => {
          this.alertService.toast(this.translate.instant('ERROR_UNKNOWN'));
        }
      });

  }

  public createSandbox() {
    this.loading = true;
    this.deckService.getList()
      .pipe(
        finalize(() => { this.loading = false; }),
        untilDestroyed(this),
        switchMap(decks => {
          const options = decks.decks
            .filter(deckEntry => deckEntry.isValid)
            .map(deckEntry => ({value: deckEntry.id, viewValue: deckEntry.name}));

          if (options.length === 0) {
            this.alertService.alert(
              this.translate.instant('GAMES_NEED_DECK'),
              this.translate.instant('GAMES_NEED_DECK_TITLE')
            );
            return EMPTY;
          }

          return from(this.showSandboxPopup(options));
        }),
        switchMap(result => {
          if (result === undefined) {
            return EMPTY;
          }
          this.loading = true;
          // Fetch both decks
          return this.deckService.getDeck(result.deck1Id).pipe(
            switchMap(deck1Result => {
              return this.deckService.getDeck(result.deck2Id).pipe(
                map(deck2Result => ({
                  deck1: deck1Result.deck.cards,
                  deck2: deck2Result.deck.cards
                }))
              );
            })
          );
        }),
        switchMap(data => {
          return this.mainSevice.createSandboxGame(data.deck1, data.deck2);
        }),
        finalize(() => { this.loading = false; })
      )
      .subscribe({
        next: () => {
          // Navigate to the newly created sandbox game
          const gameStates = this.sessionService.session.gameStates;
          if (gameStates.length > 0) {
            const lastState = gameStates[gameStates.length - 1];
            if (lastState.sandboxMode) {
              this.router.navigate(['/table', lastState.localId]);
            }
          }
        },
        error: (error: ApiError) => {
          this.alertService.toast(this.translate.instant('ERROR_UNKNOWN'));
        }
      });
  }

}
