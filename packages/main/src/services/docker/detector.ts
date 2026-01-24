/**
 * Docker Detector Service
 * Detects SQL Server containers running in Docker
 */

import Dockerode from 'dockerode';
import type {
  DockerContainer,
  DockerVolumeMapping,
  DockerDetectionResult,
  StartContainerResult,
  PathTranslation,
  ContainerState,
} from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';

export class DockerDetector extends BaseSingleton {
  private docker: Dockerode;

  constructor() {
    super();
    this.docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
  }

  /**
   * Check if Docker is running
   */
  async isDockerRunning(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect SQL Server containers
   */
  async detect(): Promise<DockerDetectionResult> {
    try {
      const isRunning = await this.isDockerRunning();

      if (!isRunning) {
        return {
          dockerRunning: false,
          containers: [],
          error: 'Docker is not running. Please start Docker Desktop.',
        };
      }

      const containers = await this.docker.listContainers({ all: true });
      const sqlContainers: DockerContainer[] = [];

      for (const container of containers) {
        const isSqlServer =
          container.Image.toLowerCase().includes('mssql') ||
          container.Image.toLowerCase().includes('sqlserver') ||
          container.Image.toLowerCase().includes('azure-sql-edge');

        if (isSqlServer) {
          const portBinding = container.Ports.find(p => p.PrivatePort === 1433);

          const volumeMappings: DockerVolumeMapping[] = (container.Mounts || [])
            .filter(m => m.Type === 'bind')
            .map(m => ({
              hostPath: m.Source || '',
              containerPath: m.Destination || '',
              mode: (m.Mode || 'rw') as 'rw' | 'ro',
            }));

          sqlContainers.push({
            id: container.Id,
            name: container.Names[0]?.replace(/^\//, '') || 'unknown',
            image: container.Image,
            state: container.State as ContainerState,
            status: container.Status,
            port: portBinding?.PublicPort || null,
            hostBinding: portBinding?.IP || '0.0.0.0',
            volumeMappings,
            created: new Date(container.Created * 1000).toISOString(),
          });
        }
      }

      return {
        dockerRunning: true,
        containers: sqlContainers,
      };
    } catch (error) {
      return {
        dockerRunning: false,
        containers: [],
        error: error instanceof Error ? error.message : 'Failed to detect Docker containers',
      };
    }
  }

  /**
   * Get volume mappings for a specific container
   */
  async getVolumeMappings(containerId: string): Promise<DockerVolumeMapping[]> {
    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();

      return (info.Mounts || [])
        .filter(m => m.Type === 'bind')
        .map(m => ({
          hostPath: m.Source || '',
          containerPath: m.Destination || '',
          mode: (m.Mode || 'rw') as 'rw' | 'ro',
        }));
    } catch {
      return [];
    }
  }

  /**
   * Start a stopped container
   */
  async startContainer(containerId: string): Promise<StartContainerResult> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.start();

      return {
        success: true,
        containerId,
      };
    } catch (error) {
      return {
        success: false,
        containerId,
        error: error instanceof Error ? error.message : 'Failed to start container',
      };
    }
  }

  /**
   * Stop a running container
   */
  async stopContainer(containerId: string): Promise<StartContainerResult> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop();

      return {
        success: true,
        containerId,
      };
    } catch (error) {
      return {
        success: false,
        containerId,
        error: error instanceof Error ? error.message : 'Failed to stop container',
      };
    }
  }

  /**
   * Translate a local path to a container path using volume mappings
   */
  translatePath(localPath: string, mappings: DockerVolumeMapping[]): PathTranslation {
    // Normalize path separators
    const normalizedLocal = localPath.replace(/\\/g, '/');

    for (const mapping of mappings) {
      const normalizedHost = mapping.hostPath.replace(/\\/g, '/');

      if (normalizedLocal.startsWith(normalizedHost)) {
        const relativePath = normalizedLocal.slice(normalizedHost.length);
        const containerPath = mapping.containerPath + relativePath;

        return {
          localPath,
          containerPath,
          isAccessible: true,
        };
      }
    }

    // Path is not mapped
    return {
      localPath,
      containerPath: localPath,
      isAccessible: false,
      suggestion: `Mount the directory as a volume. Example: -v "${localPath}:/var/opt/mssql/backups"`,
    };
  }

  /**
   * Get default SQL Server backup path in container
   */
  getDefaultBackupPath(): string {
    return '/var/opt/mssql/backups';
  }

  /**
   * Get default SQL Server data path in container
   */
  getDefaultDataPath(): string {
    return '/var/opt/mssql/data';
  }
}
