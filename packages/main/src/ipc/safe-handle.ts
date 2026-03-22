/**
 * Safe IPC handler wrapper
 * Wraps ipcMain.handle with try/catch + error logging
 */

import { ipcMain } from 'electron';
import { createLogger } from '../utils/logger';

const log = createLogger('IPC');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcHandler = (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any;

/**
 * Register an IPC handler with automatic error logging.
 * Errors are logged with the channel name then re-thrown
 * so Electron serialises them back to the renderer.
 */
export function safeHandle(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`${channel}: ${message}`);
      throw error;
    }
  });
}
