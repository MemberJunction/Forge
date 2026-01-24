import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ShellComponent } from './layout/shell/shell.component';
import { ContextMenuComponent } from './shared/components/context-menu/context-menu.component';
import { SettingsPanelComponent } from './shared/components/settings-panel/settings-panel.component';
import { TablePropertiesContainerComponent } from './shared/components/table-properties-panel/table-properties-container.component';
import { SettingsService } from './core/services/settings.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    ShellComponent,
    ContextMenuComponent,
    SettingsPanelComponent,
    TablePropertiesContainerComponent,
  ],
  template: `
    <app-shell />
    <app-context-menu />
    <app-settings-panel />
    <app-table-properties-container />
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
export class AppComponent {
  // Inject settings service to ensure it's initialized early
  private readonly settingsService = inject(SettingsService);
}
