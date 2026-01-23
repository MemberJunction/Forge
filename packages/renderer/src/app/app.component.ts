import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ShellComponent } from './layout/shell/shell.component';
import { ContextMenuComponent } from './shared/components/context-menu/context-menu.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ShellComponent, ContextMenuComponent],
  template: `
    <app-shell />
    <app-context-menu />
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
      }
    `,
  ],
})
export class AppComponent {}
