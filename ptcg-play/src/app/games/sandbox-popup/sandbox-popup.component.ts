import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { SelectPopupOption } from '../../shared/alert/select-popup/select-popup.component';

export interface SandboxPopupData {
  decks: SelectPopupOption<number>[];
}

export interface SandboxPopupResult {
  deck1Id: number;
  deck2Id: number;
}

@Component({
  selector: 'ptcg-sandbox-popup',
  templateUrl: './sandbox-popup.component.html',
  styleUrls: ['./sandbox-popup.component.scss']
})
export class SandboxPopupComponent {

  public decks: SelectPopupOption<number>[];
  public deck1Id: number;
  public deck2Id: number;

  constructor(
    private dialogRef: MatDialogRef<SandboxPopupComponent>,
    @Inject(MAT_DIALOG_DATA) data: SandboxPopupData,
  ) {
    this.decks = data.decks;
    this.deck1Id = data.decks[0].value;
    this.deck2Id = data.decks.length > 1 ? data.decks[1].value : data.decks[0].value;
  }

  public confirm() {
    this.dialogRef.close({
      deck1Id: this.deck1Id,
      deck2Id: this.deck2Id
    });
  }

  public cancel() {
    this.dialogRef.close();
  }

}
