import * as fs from 'node:fs/promises';
import type { DevPersona, PersonaRoster } from '@mj-forge/shared';
import type { ResolvedPaths } from './paths.js';
import { newId } from './util.js';

/**
 * Owns the developer-persona roster on disk (`~/.mjdev/personas.json`): the set
 * of named dev identities plus a pointer to the globally active one. Shared by
 * the GUI and the `mjdev` CLI, so writes are atomic (temp-file + rename) like
 * {@link InstanceStore}. Persona → MJ-User materialization and credential
 * minting live in {@link IdentityManager}; this class is pure persistence.
 */
export class PersonaStore {
  constructor(private readonly paths: ResolvedPaths) {}

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.paths.configDir, { recursive: true });
  }

  private async atomicWrite(contents: string): Promise<void> {
    const file = this.paths.personasFile;
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, contents);
    await fs.rename(tmp, file);
  }

  /** Read the full roster, returning an empty one if the file doesn't exist yet. */
  async read(): Promise<PersonaRoster> {
    try {
      const raw = await fs.readFile(this.paths.personasFile, 'utf8');
      const parsed = JSON.parse(raw) as PersonaRoster;
      return { personas: parsed.personas ?? [], activePersonaId: parsed.activePersonaId };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { personas: [] };
      throw err;
    }
  }

  async list(): Promise<DevPersona[]> {
    return (await this.read()).personas;
  }

  async get(id: string): Promise<DevPersona | undefined> {
    return (await this.list()).find(p => p.id === id);
  }

  /**
   * Insert or update a persona (matched by `id`; a new id is assigned when
   * omitted) and return the saved record. The first persona created becomes the
   * active one automatically.
   */
  async save(persona: Omit<DevPersona, 'id'> & { id?: string }): Promise<DevPersona> {
    await this.ensureDir();
    const roster = await this.read();
    const record: DevPersona = { ...persona, id: persona.id?.trim() || newId() };
    const idx = roster.personas.findIndex(p => p.id === record.id);
    if (idx >= 0) roster.personas[idx] = record;
    else roster.personas.push(record);
    if (!roster.activePersonaId) roster.activePersonaId = record.id;
    await this.atomicWrite(JSON.stringify(roster, null, 2));
    return record;
  }

  /**
   * Remove a persona. If it was the active one, the active pointer moves to the
   * first remaining persona (or clears when none remain).
   */
  async remove(id: string): Promise<void> {
    const roster = await this.read();
    roster.personas = roster.personas.filter(p => p.id !== id);
    if (roster.activePersonaId === id) {
      roster.activePersonaId = roster.personas[0]?.id;
    }
    await this.ensureDir();
    await this.atomicWrite(JSON.stringify(roster, null, 2));
  }

  /** The globally active persona, or undefined if the roster is empty. */
  async getActive(): Promise<DevPersona | undefined> {
    const roster = await this.read();
    if (!roster.activePersonaId) return undefined;
    return roster.personas.find(p => p.id === roster.activePersonaId);
  }

  /** Set the globally active persona (must reference an existing persona). */
  async setActive(id: string): Promise<void> {
    const roster = await this.read();
    if (!roster.personas.some(p => p.id === id)) {
      throw new Error(`No persona with id "${id}"`);
    }
    roster.activePersonaId = id;
    await this.ensureDir();
    await this.atomicWrite(JSON.stringify(roster, null, 2));
  }
}
