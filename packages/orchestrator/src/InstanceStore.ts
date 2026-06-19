import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { InstanceConfig, InstanceRecord, InstanceSecrets } from '@mj-forge/shared';
import type { ResolvedPaths } from './paths.js';

interface InstancesFile {
  version: 1;
  instances: InstanceRecord[];
}

type SecretsFile = Record<string, InstanceSecrets>;

/**
 * Owns all on-disk state: the `instances.json` record list, per-instance YAML
 * configs, and the `secrets.json` credential store. Writes are atomic
 * (temp-file + rename) so a crash mid-write can't corrupt the file the CLI and
 * GUI both read.
 */
export class InstanceStore {
  constructor(private readonly paths: ResolvedPaths) {}

  private async ensureDirs(): Promise<void> {
    await fs.mkdir(this.paths.configDir, { recursive: true });
    await fs.mkdir(this.paths.instancesDir, { recursive: true });
  }

  private async atomicWrite(file: string, contents: string, mode?: number): Promise<void> {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, contents, { mode });
    await fs.rename(tmp, file);
    if (mode !== undefined) await fs.chmod(file, mode).catch(() => {});
  }

  // ── Records ───────────────────────────────────────────────────────────

  async list(): Promise<InstanceRecord[]> {
    try {
      const raw = await fs.readFile(this.paths.instancesFile, 'utf8');
      const parsed = JSON.parse(raw) as InstancesFile;
      return parsed.instances ?? [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async get(slug: string): Promise<InstanceRecord | undefined> {
    return (await this.list()).find(i => i.slug === slug);
  }

  /** Insert or replace a record (matched by slug) and persist the full list. */
  async upsert(record: InstanceRecord): Promise<void> {
    await this.ensureDirs();
    const instances = await this.list();
    const idx = instances.findIndex(i => i.slug === record.slug);
    if (idx >= 0) instances[idx] = record;
    else instances.push(record);
    const file: InstancesFile = { version: 1, instances };
    await this.atomicWrite(this.paths.instancesFile, JSON.stringify(file, null, 2));
  }

  async remove(slug: string): Promise<void> {
    const instances = (await this.list()).filter(i => i.slug !== slug);
    const file: InstancesFile = { version: 1, instances };
    await this.atomicWrite(this.paths.instancesFile, JSON.stringify(file, null, 2));
  }

  // ── Per-instance YAML config ──────────────────────────────────────────

  private yamlPath(slug: string): string {
    return path.join(this.paths.instancesDir, `${slug}.yaml`);
  }

  async writeConfig(slug: string, config: InstanceConfig): Promise<void> {
    await this.ensureDirs();
    await this.atomicWrite(this.yamlPath(slug), stringifyYaml(config));
  }

  async readConfig(slug: string): Promise<InstanceConfig | undefined> {
    try {
      return parseYaml(await fs.readFile(this.yamlPath(slug), 'utf8')) as InstanceConfig;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async deleteConfig(slug: string): Promise<void> {
    await fs.rm(this.yamlPath(slug), { force: true });
  }

  /** Parse a YAML config from an arbitrary file path (used by `mjdev create`). */
  static async parseConfigFile(file: string): Promise<InstanceConfig> {
    const raw = await fs.readFile(file, 'utf8');
    const cfg = parseYaml(raw) as InstanceConfig;
    if (!cfg || typeof cfg.name !== 'string' || !cfg.name.trim()) {
      throw new Error(`Config ${file} must define a non-empty "name"`);
    }
    return cfg;
  }

  // ── Secrets ───────────────────────────────────────────────────────────

  private async readSecretsFile(): Promise<SecretsFile> {
    try {
      return JSON.parse(await fs.readFile(this.paths.secretsFile, 'utf8')) as SecretsFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  async setSecrets(ref: string, secrets: InstanceSecrets): Promise<void> {
    await this.ensureDirs();
    const all = await this.readSecretsFile();
    all[ref] = secrets;
    await this.atomicWrite(this.paths.secretsFile, JSON.stringify(all, null, 2), 0o600);
  }

  async getSecrets(ref: string): Promise<InstanceSecrets | undefined> {
    return (await this.readSecretsFile())[ref];
  }

  async deleteSecrets(ref: string): Promise<void> {
    const all = await this.readSecretsFile();
    if (ref in all) {
      delete all[ref];
      await this.atomicWrite(this.paths.secretsFile, JSON.stringify(all, null, 2), 0o600);
    }
  }
}
