import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ShellComponent } from './layout/shell/shell.component';
import { ContextMenuComponent } from './shared/components/context-menu/context-menu.component';
import { SettingsPanelComponent } from './shared/components/settings-panel/settings-panel.component';
import { TablePropertiesContainerComponent } from './shared/components/table-properties-panel/table-properties-container.component';
import { CommandPaletteComponent } from './shared/components/command-palette/command-palette.component';
import { ObjectSearchComponent } from './shared/components/object-search/object-search.component';
import { ShortcutsDialogComponent } from './shared/components/shortcuts-dialog/shortcuts-dialog.component';
import { SettingsService } from './core/services/settings.service';
import { ConnectionStateService } from './core/state/connection.state';
import { TabStateService } from './core/state/tab.state';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    ShellComponent,
    ContextMenuComponent,
    SettingsPanelComponent,
    TablePropertiesContainerComponent,
    CommandPaletteComponent,
    ObjectSearchComponent,
    ShortcutsDialogComponent,
  ],
  template: `
    <app-shell />
    <app-context-menu />
    <app-settings-panel />
    <app-table-properties-container />
    <app-command-palette />
    <app-object-search />
    <app-shortcuts-dialog />
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
export class AppComponent implements OnInit {
  // Inject settings service to ensure it's initialized early
  private readonly settingsService = inject(SettingsService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);

  async ngOnInit(): Promise<void> {
    // Load connection profiles first
    await this.connectionState.loadProfiles();
    // Restore previous connection state
    await this.connectionState.restoreState();
    // Restore tabs if we have a connection
    if (this.connectionState.isConnected() && this.connectionState.activeConnectionId()) {
      await this.tabState.restoreTabs(this.connectionState.activeConnectionId()!);
    }
  }
}
