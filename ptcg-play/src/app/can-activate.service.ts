import { ActivatedRouteSnapshot, CanActivate, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { LoginPopupService } from './login/login-popup/login-popup.service';
import { SessionService } from './shared/session/session.service';

@Injectable({
  providedIn: 'root'
})
export class CanActivateService implements CanActivate  {

  constructor(
    private loginPopupService: LoginPopupService,
    private sessionService: SessionService,
    private router: Router
  ) { }

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot
  ): Observable<boolean | UrlTree> | Promise<boolean|UrlTree> | boolean| UrlTree {
    // Local-only mode: always allow navigation, no auth guard
    return true;
  }

}
