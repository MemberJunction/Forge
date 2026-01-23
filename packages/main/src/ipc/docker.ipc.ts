/**
 * Docker IPC Handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type {
  DockerDetectionResult,
  DockerVolumeMapping,
  StartContainerResult,
} from '@mj-forge/shared';
import { DockerDetector } from '../services/docker/detector';

export function registerDockerHandlers(): void {
  const dockerDetector = DockerDetector.getInstance();

  // Detect SQL Server containers
  ipcMain.handle(IPC_CHANNELS.DOCKER.DETECT, async (): Promise<DockerDetectionResult> => {
    return dockerDetector.detect();
  });

  // Get volume mappings for a container
  ipcMain.handle(
    IPC_CHANNELS.DOCKER.GET_VOLUMES,
    async (_event, containerId: string): Promise<DockerVolumeMapping[]> => {
      return dockerDetector.getVolumeMappings(containerId);
    }
  );

  // Start a container
  ipcMain.handle(
    IPC_CHANNELS.DOCKER.START_CONTAINER,
    async (_event, containerId: string): Promise<StartContainerResult> => {
      return dockerDetector.startContainer(containerId);
    }
  );
}
