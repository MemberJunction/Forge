/**
 * Window Management
 */

import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import Store from 'electron-store';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

const windowStateStore = new Store<{ windowState: WindowState }>({
  name: 'window-state',
  defaults: {
    windowState: {
      width: 1400,
      height: 900,
      isMaximized: false,
    },
  },
});

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const state = windowStateStore.get('windowState');

  // Validate window position is on a visible display
  const displays = screen.getAllDisplays();
  let validPosition = false;

  if (state.x !== undefined && state.y !== undefined) {
    for (const display of displays) {
      const { x, y, width, height } = display.bounds;
      if (state.x >= x && state.x < x + width && state.y >= y && state.y < y + height) {
        validPosition = true;
        break;
      }
    }
  }

  mainWindow = new BrowserWindow({
    x: validPosition ? state.x : undefined,
    y: validPosition ? state.y : undefined,
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e1e',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../../preload/dist/index.js'),
    },
  });

  // Restore maximized state
  if (state.isMaximized) {
    mainWindow.maximize();
  }

  // Save window state on changes
  const saveState = () => {
    if (!mainWindow) return;

    const bounds = mainWindow.getBounds();
    windowStateStore.set('windowState', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
    });
  };

  mainWindow.on('resize', saveState);
  mainWindow.on('move', saveState);
  mainWindow.on('close', saveState);

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:4200');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/browser/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
