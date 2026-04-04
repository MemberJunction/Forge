/**
 * Application Menu - macOS-style menu system
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
              {
                label: 'Settings...',
                accelerator: 'Cmd+,',
                click: () => {
                  const win = BrowserWindow.getFocusedWindow();
                  win?.webContents.send('menu:open-settings');
                },
              },
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
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:close-tab');
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
        {
          label: 'Export Results...',
          accelerator: 'CmdOrCtrl+Shift+X',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:export-results');
          },
        },
        { type: 'separator' },
        { role: 'quit' },
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
        {
          role: 'selectAll',
          accelerator: 'CmdOrCtrl+A',
          registerAccelerator: false,
        },
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
          label: 'Find and Replace',
          accelerator: isMac ? 'Cmd+Option+F' : 'Ctrl+H',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:replace');
          },
        },
        { type: 'separator' },
        {
          label: 'Format SQL',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:format-sql');
          },
        },
        {
          label: 'Toggle Comment',
          accelerator: 'CmdOrCtrl+/',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:toggle-comment');
          },
        },
        { type: 'separator' },
        {
          label: isMac ? 'Settings...' : 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:open-settings');
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
          accelerator: 'CmdOrCtrl+E',
          registerAccelerator: false,
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:execute-query');
          },
        },
        {
          label: 'Execute Selection',
          accelerator: isMac ? 'Cmd+Shift+Return' : 'Ctrl+Shift+E',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:execute-selection');
          },
        },
        { type: 'separator' },
        {
          label: 'Cancel Execution',
          accelerator: isMac ? 'Cmd+.' : 'Alt+Break',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:cancel-query');
          },
        },
        { type: 'separator' },
        {
          label: 'Query History...',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:query-history');
          },
        },
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
          label: 'Refresh Object Explorer',
          accelerator: isMac ? 'Cmd+Shift+R' : 'Ctrl+Shift+R',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:refresh');
          },
        },
        { type: 'separator' },
        {
          label: 'Server Properties...',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:server-properties');
          },
        },
      ],
    },

    // Database menu
    {
      label: 'Database',
      submenu: [
        {
          label: 'New Database...',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:new-database');
          },
        },
        { type: 'separator' },
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
        { type: 'separator' },
        {
          label: 'Database Properties...',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:database-properties');
          },
        },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Welcome',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:show-welcome');
          },
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:toggle-sidebar');
          },
        },
        {
          label: 'Toggle AI Chat',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:toggle-chat');
          },
        },
        {
          label: 'Toggle Results Panel',
          accelerator: 'CmdOrCtrl+Shift+\\',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:toggle-results');
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'reload', label: 'Reload Window', visible: true },
        { role: 'forceReload', label: 'Force Reload', visible: true },
        { role: 'toggleDevTools' },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: isMac ? 'Cmd+Shift+]' : 'Ctrl+Tab',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:next-tab');
          },
        },
        {
          label: 'Previous Tab',
          accelerator: isMac ? 'Cmd+Shift+[' : 'Ctrl+Shift+Tab',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:previous-tab');
          },
        },
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
          label: 'MJ Forge Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/MemberJunction/mj-forge');
          },
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+Shift+/',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            win?.webContents.send('menu:show-shortcuts');
          },
        },
        { type: 'separator' },
        {
          label: 'Report Issue...',
          click: async () => {
            await shell.openExternal('https://github.com/MemberJunction/mj-forge/issues');
          },
        },
        { type: 'separator' },
        {
          label: 'T-SQL Reference',
          click: async () => {
            await shell.openExternal(
              'https://docs.microsoft.com/en-us/sql/t-sql/language-reference'
            );
          },
        },
        {
          label: 'SQL Server Documentation',
          click: async () => {
            await shell.openExternal('https://docs.microsoft.com/en-us/sql/sql-server/');
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
