import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'dark' | 'light' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<ThemeMode>('system');
  readonly theme = this._theme.asReadonly();

  constructor() {
    const saved = localStorage.getItem('forge-theme') as ThemeMode | null;
    if (saved) {
      this._theme.set(saved);
      this.applyTheme(saved);
    }
  }

  setTheme(mode: ThemeMode): void {
    this._theme.set(mode);
    localStorage.setItem('forge-theme', mode);
    this.applyTheme(mode);
  }

  toggle(): void {
    const current = this._theme();
    const next: ThemeMode = current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
    this.setTheme(next);
  }

  private applyTheme(mode: ThemeMode): void {
    const root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', mode);
    }
  }
}
