/**
 * Docker IPC Handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type {
  DockerStatus,
  DockerContainer,
  DockerVolume,
  DockerVolumeMapping,
} from '@mj-forge/shared';
import { DockerDetector } from '../services/docker/detector';

export function registerDockerHandlers(): void {
  const dockerDetector = DockerDetector.getInstance();

  // Detect Docker status
  ipcMain.handle(IPC_CHANNELS.DOCKER.DETECT, async (): Promise<DockerStatus> => {
    const result = await dockerDetector.detect();
    return {
      isAvailable: true, // If we get a response, Docker socket exists
      isRunning: result.dockerRunning,
      error: result.error,
      containers: result.containers,
    };
  });

  // Get SQL Server containers
  ipcMain.handle(IPC_CHANNELS.DOCKER.GET_CONTAINERS, async (): Promise<DockerContainer[]> => {
    const result = await dockerDetector.detect();
    // Add isSqlServer flag and ports array
    return result.containers.map(c => ({
      ...c,
      isSqlServer: true,
      ports: c.port ? [{ internal: 1433, external: c.port }] : [],
    }));
  });

  // Get Docker volumes
  ipcMain.handle(IPC_CHANNELS.DOCKER.GET_VOLUMES, async (): Promise<DockerVolume[]> => {
    // For now, return empty array - could be expanded later
    return [];
  });

  // Start a container
  ipcMain.handle(
    IPC_CHANNELS.DOCKER.START_CONTAINER,
    async (_event, containerId: string): Promise<void> => {
      const result = await dockerDetector.startContainer(containerId);
      if (!result.success) {
        throw new Error(result.error || 'Failed to start container');
      }
    }
  );

  // Stop a container
  ipcMain.handle(
    IPC_CHANNELS.DOCKER.STOP_CONTAINER,
    async (_event, containerId: string): Promise<void> => {
      await dockerDetector.stopContainer(containerId);
    }
  );
}
