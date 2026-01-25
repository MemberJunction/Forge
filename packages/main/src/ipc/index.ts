/**
 * Register all IPC handlers
 */

import { registerConnectionHandlers } from './connection.ipc';
import { registerDockerHandlers } from './docker.ipc';
import { registerDatabaseHandlers } from './database.ipc';
import { registerExplorerHandlers } from './explorer.ipc';
import { registerQueryHandlers } from './query.ipc';
import { registerQueryResultsHandlers } from './query-results.ipc';
import { registerBackupHandlers } from './backup.ipc';
import { registerAppHandlers } from './app.ipc';
import { registerAIHandlers } from './ai.ipc';

export function registerAllHandlers(): void {
  registerConnectionHandlers();
  registerDockerHandlers();
  registerDatabaseHandlers();
  registerExplorerHandlers();
  registerQueryHandlers();
  registerQueryResultsHandlers();
  registerBackupHandlers();
  registerAppHandlers();
  registerAIHandlers();
}
