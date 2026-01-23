import { Injectable, signal, computed } from '@angular/core';
import type { AppSettings, ThemePreference } from '@mj-forge/shared';
import { DEFAULT_SETTINGS } from '@mj-forge/shared';

const STORAGE_KEY = 'mj-forge-settings';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly _settings = signal<AppSettings>(this.loadSettings());
  private readonly _isOpen = signal(false);

  // Public readonly signals
  readonly settings = this._settings.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();

  // Computed values for easy access
  readonly theme = computed(() => this._settings().theme);
  readonly editorSettings = computed(() => this._settings().editor);
  readonly querySettings = computed(() => this._settings().query);
  readonly gridSettings = computed(() => this._settings().grid);

  // Computed theme for actual CSS application
  readonly effectiveTheme = computed(() => {
    const preference = this._settings().theme;
    if (preference === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return preference;
  });

  constructor() {
    // Apply initial theme
    this.applyTheme(this._settings().theme);

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this._settings().theme === 'system') {
        this.applyTheme('system');
      }
    });
  }

  open(): void {
    this._isOpen.set(true);
  }

  close(): void {
    this._isOpen.set(false);
  }

  toggle(): void {
    this._isOpen.update(open => !open);
  }

  updateSettings(partial: Partial<AppSettings>): void {
    this._settings.update(current => {
      const updated = { ...current, ...partial };
      this.saveSettings(updated);
      return updated;
    });
  }

  updateTheme(theme: ThemePreference): void {
    this._settings.update(current => {
      const updated = { ...current, theme };
      this.saveSettings(updated);
      this.applyTheme(theme);
      return updated;
    });
  }

  updateEditorSetting<K extends keyof AppSettings['editor']>(
    key: K,
    value: AppSettings['editor'][K]
  ): void {
    this._settings.update(current => {
      const updated = {
        ...current,
        editor: { ...current.editor, [key]: value },
      };
      this.saveSettings(updated);
      return updated;
    });
  }

  updateQuerySetting<K extends keyof AppSettings['query']>(
    key: K,
    value: AppSettings['query'][K]
  ): void {
    this._settings.update(current => {
      const updated = {
        ...current,
        query: { ...current.query, [key]: value },
      };
      this.saveSettings(updated);
      return updated;
    });
  }

  updateGridSetting<K extends keyof AppSettings['grid']>(
    key: K,
    value: AppSettings['grid'][K]
  ): void {
    this._settings.update(current => {
      const updated = {
        ...current,
        grid: { ...current.grid, [key]: value },
      };
      this.saveSettings(updated);
      return updated;
    });
  }

  resetToDefaults(): void {
    this._settings.set(DEFAULT_SETTINGS);
    this.saveSettings(DEFAULT_SETTINGS);
    this.applyTheme(DEFAULT_SETTINGS.theme);
  }

  private loadSettings(): AppSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<AppSettings>;
        // Merge with defaults to ensure all properties exist
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
          query: { ...DEFAULT_SETTINGS.query, ...parsed.query },
          grid: { ...DEFAULT_SETTINGS.grid, ...parsed.grid },
        };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    return DEFAULT_SETTINGS;
  }

  private saveSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  private applyTheme(preference: ThemePreference): void {
    const root = document.documentElement;

    if (preference === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', preference);
    }
  }
}
