import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { CanActivateService } from './can-activate.service';
import { DeckComponent } from './deck/deck.component';
import { DeckEditComponent } from './deck/deck-edit/deck-edit.component';
import { GamesComponent } from './games/games.component';
import { LoginComponent } from './login/login/login.component';
import { MessagesComponent } from './messages/messages.component';
import { ProfileComponent } from './profile/profile.component';
import { RankingComponent } from './ranking/ranking.component';
import { RegisterComponent } from './login/register/register.component';
import { ReplaysComponent } from './replays/replays.component';
import { ResetPasswordComponent } from './login/reset-password/reset-password.component';
import { SetNewPasswordComponent } from './login/set-new-password/set-new-password.component';
import { TableComponent } from './table/table.component';

const routes: Routes = [
    // Core gameplay routes — no auth guard needed in local-only mode
    { path: 'games', component: GamesComponent },
    { path: 'deck', component: DeckComponent },
    { path: 'deck/:deckId', component: DeckEditComponent },
    { path: 'table/:gameId', component: TableComponent },
    { path: 'replays', component: ReplaysComponent },

    // Keep login route for auto-login flow (redirects to /games automatically)
    { path: 'login', redirectTo: '/games', pathMatch: 'full' },
    { path: 'register', redirectTo: '/games', pathMatch: 'full' },
    { path: 'reset-password', redirectTo: '/games', pathMatch: 'full' },

    // Keep these routes functional but they're hidden from nav
    { path: 'message', redirectTo: '/games', pathMatch: 'full' },
    { path: 'message/:userId', component: MessagesComponent },
    { path: 'ranking', component: RankingComponent },
    { path: 'profile/:userId', component: ProfileComponent },

    // Default: go straight to games
    { path: '', redirectTo: '/games', pathMatch: 'full' },
    { path: '**', redirectTo: '/games' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { relativeLinkResolution: 'legacy' })],
  exports: [RouterModule]
})
export class AppRoutingModule { }
