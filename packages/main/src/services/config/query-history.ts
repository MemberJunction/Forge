/**
 * Query History Storage
 * Stores executed query history with metadata
 */

import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import type { QueryHistoryEntry, QueryHistoryFilter } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';

interface QueryHistorySchema {
  entries: QueryHistoryEntry[];
  version: number;
}

const MAX_HISTORY_ENTRIES = 1000;

export class QueryHistoryStore extends BaseSingleton {
  private store: Store<QueryHistorySchema>;

  constructor() {
    super();
    this.store = new Store<QueryHistorySchema>({
      name: 'query-history',
      defaults: {
        entries: [],
        version: 1,
      },
    });
  }

  /**
   * Add a query to history
   */
  add(entry: Omit<QueryHistoryEntry, 'id'>): QueryHistoryEntry {
    const entries = this.store.get('entries', []);

    const newEntry: QueryHistoryEntry = {
      ...entry,
      id: uuidv4(),
    };

    // Add to beginning of array (most recent first)
    entries.unshift(newEntry);

    // Trim to max entries
    if (entries.length > MAX_HISTORY_ENTRIES) {
      entries.splice(MAX_HISTORY_ENTRIES);
    }

    this.store.set('entries', entries);
    return newEntry;
  }

  /**
   * Get query history with optional filtering
   */
  getHistory(filter?: QueryHistoryFilter): QueryHistoryEntry[] {
    let entries = this.store.get('entries', []);

    if (filter) {
      if (filter.connectionId) {
        entries = entries.filter(e => e.connectionId === filter.connectionId);
      }

      if (filter.database) {
        entries = entries.filter(e => e.database.toLowerCase() === filter.database!.toLowerCase());
      }

      if (filter.searchText) {
        const searchLower = filter.searchText.toLowerCase();
        entries = entries.filter(
          e =>
            e.sql.toLowerCase().includes(searchLower) ||
            e.connectionName.toLowerCase().includes(searchLower) ||
            e.database.toLowerCase().includes(searchLower)
        );
      }

      if (filter.startDate) {
        const start = new Date(filter.startDate);
        entries = entries.filter(e => new Date(e.executedAt) >= start);
      }

      if (filter.endDate) {
        const end = new Date(filter.endDate);
        entries = entries.filter(e => new Date(e.executedAt) <= end);
      }

      if (filter.successOnly) {
        entries = entries.filter(e => e.success);
      }

      if (filter.limit && filter.limit > 0) {
        entries = entries.slice(0, filter.limit);
      }
    }

    return entries;
  }

  /**
   * Delete a single history entry
   */
  deleteEntry(id: string): boolean {
    const entries = this.store.get('entries', []);
    const index = entries.findIndex(e => e.id === id);

    if (index === -1) {
      return false;
    }

    entries.splice(index, 1);
    this.store.set('entries', entries);
    return true;
  }

  /**
   * Clear all history
   */
  clearAll(): void {
    this.store.set('entries', []);
  }

  /**
   * Clear history for a specific connection
   */
  clearForConnection(connectionId: string): number {
    const entries = this.store.get('entries', []);
    const newEntries = entries.filter(e => e.connectionId !== connectionId);
    const deletedCount = entries.length - newEntries.length;
    this.store.set('entries', newEntries);
    return deletedCount;
  }

  /**
   * Get unique databases from history
   */
  getUniqueDatabases(): string[] {
    const entries = this.store.get('entries', []);
    const databases = new Set(entries.map(e => e.database));
    return Array.from(databases).sort();
  }

  /**
   * Get history count
   */
  getCount(): number {
    return this.store.get('entries', []).length;
  }
}
