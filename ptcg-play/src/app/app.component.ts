import { Component, OnInit, HostListener, ElementRef } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { UserInfo } from 'ptcg-server';
import { Observable, interval, Subject } from 'rxjs';
import { Router } from '@angular/router';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
import { switchMap, filter } from 'rxjs/operators';

import { AlertService } from './shared/alert/alert.service';
import { LoginRememberService } from './login/login-remember.service';
import { LoginService } from './api/services/login.service';
import { SessionService } from './shared/session/session.service';
import { SocketService } from './api/socket.service';
import { TranslateService } from '@ngx-translate/core';
import { environment } from '../environments/environment';

@UntilDestroy()
@Component({
  selector: 'ptcg-app',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {

  public isLoggedIn = false;
  public loggedUser: UserInfo | undefined;
  private authToken$: Observable<string>;
  private loginAborted$ = new Subject<void>();

  constructor(
    private alertService: AlertService,
    private dialog: MatDialog,
    private elementRef: ElementRef<HTMLElement>,
    private loginService: LoginService,
    private loginRememberService: LoginRememberService,
    private router: Router,
    private sessionService: SessionService,
    private socketService: SocketService,
    private translate: TranslateService
  ) {
    this.authToken$ = this.sessionService.get(session => session.authToken);
    setTimeout(() => this.onResize());
  }

  public ngOnInit() {
    // Connect to websockets after when logged in
    this.authToken$
      .pipe(untilDestroyed(this))
      .subscribe(authToken => {
        this.isLoggedIn = !!authToken;

        // Connect to websockets
        if (this.isLoggedIn && !this.socketService.isEnabled) {
          this.socketService.enable(authToken);
        }
        if (!this.isLoggedIn && this.socketService.isEnabled) {
          this.socketService.disable();
        }
      });

    this.socketService.connection.pipe(
      untilDestroyed(this)
    ).subscribe({
      next: async connected => {
        if (!connected && this.isLoggedIn) {
          // Reconnect silently after a disconnect.
          const token = this.sessionService.session.authToken;
          if (token) {
            this.socketService.enable(token);
          }
        }
      }
    });

    // Refresh token with given interval
    interval(environment.refreshTokenInterval).pipe(
      untilDestroyed(this),
      filter(() => !!this.sessionService.session.authToken),
      switchMap(() => this.loginService.refreshToken())
    ).subscribe({
      next: response => {
        this.sessionService.session.authToken = response.token;
        if (this.loginRememberService.token) {
          this.loginRememberService.rememberToken(response.token);
        }
      }
    });

    // Local-only mode: auto-login as "player" on startup
    this.autoLogin();
  }

  /**
   * Auto-login for local-only solo play.
   * Tries token login first (from localStorage), then login with player/player,
   * then register + login if the user doesn't exist yet.
   */
  private autoLogin() {
    const token = this.loginRememberService.token;
    if (token) {
      this.loginService.tokenLogin(token, this.loginAborted$).pipe(
        untilDestroyed(this)
      ).subscribe({
        next: response => {
          this.loginRememberService.rememberToken(response.token);
        },
        error: () => {
          this.loginRememberService.rememberToken();
          this.loginWithCredentials();
        }
      });
    } else {
      this.loginWithCredentials();
    }
  }

  private loginWithCredentials() {
    const name = 'player';
    const password = 'player';

    this.loginService.login(name, password, this.loginAborted$).pipe(
      untilDestroyed(this)
    ).subscribe({
      next: response => {
        this.loginRememberService.rememberToken(response.token);
      },
      error: () => {
        // User doesn't exist yet — register then login
        this.loginService.register(name, password, '', '').pipe(
          untilDestroyed(this)
        ).subscribe({
          next: () => {
            this.loginService.login(name, password, this.loginAborted$).pipe(
              untilDestroyed(this)
            ).subscribe({
              next: response => {
                this.loginRememberService.rememberToken(response.token);
              },
              error: err => {
                console.error('Auto-login failed after register:', err);
              }
            });
          },
          error: err => {
            console.error('Auto-register failed:', err);
          }
        });
      }
    });
  }

  @HostListener('window:resize', ['$event'])
  onResize(event?: Event) {
    const element = this.elementRef.nativeElement;
    const toolbarHeight = 64;
    const contentHeight = element.offsetHeight - toolbarHeight;
    const cardAspectRatio = 1.37;
    const padding = 16;
    const cardHeight = (contentHeight - (padding * 5)) / 7;
    let cardSize = Math.floor(cardHeight / cardAspectRatio);
    cardSize = Math.min(Math.max(cardSize, 50), 100);
    element.style.setProperty('--card-size', cardSize + 'px');
  }

}
