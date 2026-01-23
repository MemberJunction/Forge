/**
 * Application Menu
 */

import { Menu, app, shell, BrowserWindow } from 'electron';

export function createMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Connection...',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:new-connection');
          },
        },
        { type: 'separator' },
        {
          label: 'New Query',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:new-query');
          },
        },
        {
          label: 'Open Query...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:open-query');
          },
        },
        { type: 'separator' },
        {
          label: 'Save Query',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:save-query');
          },
        },
        {
          label: 'Save Query As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:save-query-as');
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },

    // Server menu
    {
      label: 'Server',
      submenu: [
        {
          label: 'Connect...',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:new-connection');
          },
        },
        {
          label: 'Disconnect',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:disconnect');
          },
        },
        { type: 'separator' },
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:refresh');
          },
        },
      ],
    },

    // Database menu
    {
      label: 'Database',
      submenu: [
        {
          label: 'Backup...',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:backup');
          },
        },
        {
          label: 'Restore...',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:restore');
          },
        },
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:find');
          },
        },
        {
          label: 'Replace',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:replace');
          },
        },
      ],
    },

    // Query menu
    {
      label: 'Query',
      submenu: [
        {
          label: 'Execute',
          accelerator: 'CmdOrCtrl+Return',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:execute-query');
          },
        },
        {
          label: 'Execute Selection',
          accelerator: 'CmdOrCtrl+Shift+Return',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:execute-selection');
          },
        },
        { type: 'separator' },
        {
          label: 'Cancel Execution',
          accelerator: 'Escape',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:cancel-query');
          },
        },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:toggle-sidebar');
          },
        },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },

    // Help menu
    {
      role: 'help',
      submenu: [
        {
          label: 'Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/MemberJunction/Forge');
          },
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/MemberJunction/Forge/issues');
          },
        },
        { type: 'separator' },
        {
          label: 'About MemberJunction',
          click: async () => {
            await shell.openExternal('https://github.com/MemberJunction/MJ');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
