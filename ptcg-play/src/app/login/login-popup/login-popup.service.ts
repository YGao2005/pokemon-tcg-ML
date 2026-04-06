import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';

import { LoginPopupComponent } from './login-popup.component';

@Injectable({
  providedIn: 'root'
})
export class LoginPopupService {

  public redirectUrl: string;

  constructor(public dialog: MatDialog) {
    this.redirectUrl = '/games';
  }

  openDialog(): void {
    // Local-only mode: don't show login dialog, just log a warning
    console.warn('LoginPopupService.openDialog() called in local-only mode — suppressed.');
  }

}
