import { Component } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { InstancesPanelComponent } from './instances-panel.component';

/**
 * Dialog host for the Instances control panel — the primary way the GUI
 * surfaces MJ Dev Manager without entangling the golden-layout pane system.
 */
@Component({
  selector: 'app-instances-dialog',
  standalone: true,
  imports: [MatDialogModule, MatIconModule, MatButtonModule, InstancesPanelComponent],
  template: `
    <div class="head">
      <h1><mat-icon>dns</mat-icon> MJ Dev Manager</h1>
      <button mat-icon-button (click)="ref.close()" aria-label="Close">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <app-instances-panel />
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 80vh;
        width: 100%;
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border-color, #333);
      }
      .head h1 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 16px;
        margin: 0;
      }
      app-instances-panel {
        flex: 1;
        min-height: 0;
      }
    `,
  ],
})
export class InstancesDialogComponent {
  constructor(public readonly ref: MatDialogRef<InstancesDialogComponent>) {}
}
