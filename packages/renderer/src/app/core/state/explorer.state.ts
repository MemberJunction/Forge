import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import type {
  ObjectMetadata,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
} from '@mj-forge/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';
import { firstValueFrom } from 'rxjs';

export type NodeType =
  | 'server'
  | 'database'
  | 'folder'
  | 'table'
  | 'view'
  | 'procedure'
  | 'function'
  | 'columns_folder'
  | 'indexes_folder'
  | 'keys_folder'
  | 'constraints_folder'
  | 'triggers_folder'
  | 'column'
  | 'index'
  | 'foreign_key'
  | 'constraint'
  | 'trigger';

export interface TreeNode {
  id: string;
  name: string;
  type: NodeType;
  icon: string;
  path: string;
  children?: TreeNode[];
  hasChildren: boolean;
  isExpanded: boolean;
  isLoading: boolean;
  metadata?: ObjectMetadata;
  connectionId?: string;
  databaseName?: string;
  schema?: string;
  tableName?: string;
  columnInfo?: ColumnInfo;
  indexInfo?: IndexInfo;
  foreignKeyInfo?: ForeignKeyInfo;
  constraintInfo?: ConstraintInfo;
  triggerInfo?: TriggerInfo;
}

@Injectable({ providedIn: 'root' })
export class ExplorerStateService {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);

  private readonly _rootNodes = signal<TreeNode[]>([]);
  private readonly _selectedNodeId = signal<string | null>(null);
  private readonly _expandedNodeIds = signal<Set<string>>(new Set());
  private readonly _loadingNodeIds = signal<Set<string>>(new Set());

  // Public readonly
  readonly rootNodes = this._rootNodes.asReadonly();
  readonly selectedNodeId = this._selectedNodeId.asReadonly();
  readonly expandedNodeIds = this._expandedNodeIds.asReadonly();

  // Computed
  readonly selectedNode = computed(() => {
    const id = this._selectedNodeId();
    if (!id) return null;
    return this.findNodeById(this._rootNodes(), id);
  });

  readonly hasNodes = computed(() => this._rootNodes().length > 0);

  // Observables
  readonly rootNodes$ = toObservable(this.rootNodes);
  readonly selectedNode$ = toObservable(this.selectedNode);

  private readonly iconMap: Record<string, string> = {
    server: 'dns',
    database: 'database-cylinder',
    folder: 'folder',
    table: 'table_chart',
    view: 'view_list',
    procedure: 'functions',
    function: 'calculate',
    columns_folder: 'view_column',
    indexes_folder: 'format_list_numbered',
    keys_folder: 'key',
    constraints_folder: 'check_circle',
    triggers_folder: 'bolt',
    column: 'view_column',
    index: 'format_list_numbered',
    foreign_key: 'link',
    constraint: 'check_circle',
    trigger: 'bolt',
  };

  addServerNode(connectionId: string, serverName: string): void {
    const node: TreeNode = {
      id: `server-${connectionId}`,
      name: serverName,
      type: 'server',
      icon: this.iconMap['server'],
      path: '',
      hasChildren: true,
      isExpanded: false,
      isLoading: false,
      connectionId,
    };

    this._rootNodes.update(nodes => {
      // Replace if exists, otherwise add
      const existing = nodes.findIndex(n => n.connectionId === connectionId);
      if (existing >= 0) {
        const updated = [...nodes];
        updated[existing] = node;
        return updated;
      }
      return [...nodes, node];
    });
  }

  removeServerNode(connectionId: string): void {
    this._rootNodes.update(nodes => nodes.filter(n => n.connectionId !== connectionId));
  }

  async expandNode(nodeId: string): Promise<void> {
    const node = this.findNodeById(this._rootNodes(), nodeId);
    if (!node || !node.hasChildren) return;

    // Already expanded and has children loaded
    if (node.isExpanded && node.children && node.children.length > 0) {
      return;
    }

    // Mark as loading
    this._loadingNodeIds.update(ids => new Set([...ids, nodeId]));
    this.updateNode(nodeId, { isLoading: true });

    try {
      const children = await this.loadChildren(node);
      this.updateNode(nodeId, {
        children,
        isExpanded: true,
        isLoading: false,
      });
      this._expandedNodeIds.update(ids => new Set([...ids, nodeId]));
    } catch (error) {
      this.notification.error('Failed to load items');
      console.error('Failed to expand node:', error);
      this.updateNode(nodeId, { isLoading: false });
    } finally {
      this._loadingNodeIds.update(ids => {
        const newIds = new Set(ids);
        newIds.delete(nodeId);
        return newIds;
      });
    }
  }

  collapseNode(nodeId: string): void {
    this.updateNode(nodeId, { isExpanded: false });
    this._expandedNodeIds.update(ids => {
      const newIds = new Set(ids);
      newIds.delete(nodeId);
      return newIds;
    });
  }

  toggleNode(nodeId: string): void {
    const node = this.findNodeById(this._rootNodes(), nodeId);
    if (!node) return;

    if (node.isExpanded) {
      this.collapseNode(nodeId);
    } else {
      this.expandNode(nodeId);
    }
  }

  selectNode(nodeId: string | null): void {
    this._selectedNodeId.set(nodeId);
  }

  async refreshNode(nodeId: string): Promise<void> {
    const node = this.findNodeById(this._rootNodes(), nodeId);
    if (!node) return;

    this.updateNode(nodeId, { isLoading: true, children: undefined });

    try {
      const children = await this.loadChildren(node);
      this.updateNode(nodeId, {
        children,
        isExpanded: true,
        isLoading: false,
      });
    } catch (error) {
      this.notification.error('Failed to refresh');
      console.error('Failed to refresh node:', error);
      this.updateNode(nodeId, { isLoading: false });
    }
  }

  clear(): void {
    this._rootNodes.set([]);
    this._selectedNodeId.set(null);
    this._expandedNodeIds.set(new Set());
    this._loadingNodeIds.set(new Set());
  }

  private async loadChildren(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId) return [];

    if (node.type === 'server') {
      // Load databases
      const databases = await firstValueFrom(this.ipc.listDatabases(node.connectionId));
      return databases.map(db => ({
        id: `db-${node.connectionId}-${db.name}`,
        name: db.name,
        type: 'database' as const,
        icon: this.iconMap['database'],
        path: db.name,
        hasChildren: true,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: db.name,
        metadata: {
          name: db.name,
          type: 'database',
          schema: '',
        } as ObjectMetadata,
      }));
    }

    if (node.type === 'database' && node.databaseName) {
      // Return folder nodes for database objects
      return this.getDatabaseFolders(node.connectionId, node.databaseName);
    }

    if (node.type === 'folder' && node.databaseName) {
      // Load objects from the folder
      const objects = await firstValueFrom(
        this.ipc.getExplorerChildren(node.connectionId, node.databaseName, node.path)
      );
      return objects.map(obj => this.metadataToNode(obj, node));
    }

    // Table sub-folders
    if (node.type === 'table' && node.databaseName && node.schema && node.tableName) {
      return this.getTableSubFolders(node);
    }

    // Load columns for a table
    if (node.type === 'columns_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadColumns(node);
    }

    // Load indexes for a table
    if (node.type === 'indexes_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadIndexes(node);
    }

    // Load foreign keys for a table
    if (node.type === 'keys_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadForeignKeys(node);
    }

    // Load constraints for a table
    if (node.type === 'constraints_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadConstraints(node);
    }

    // Load triggers for a table
    if (node.type === 'triggers_folder' && node.databaseName && node.schema && node.tableName) {
      return this.loadTriggers(node);
    }

    return [];
  }

  private getTableSubFolders(node: TreeNode): TreeNode[] {
    const folders = [
      { name: 'Columns', type: 'columns_folder' as NodeType },
      { name: 'Indexes', type: 'indexes_folder' as NodeType },
      { name: 'Keys', type: 'keys_folder' as NodeType },
      { name: 'Constraints', type: 'constraints_folder' as NodeType },
      { name: 'Triggers', type: 'triggers_folder' as NodeType },
    ];

    return folders.map(folder => ({
      id: `${node.id}-${folder.type}`,
      name: folder.name,
      type: folder.type,
      icon: this.iconMap[folder.type] || 'folder',
      path: `${node.path}/${folder.type}`,
      hasChildren: true,
      isExpanded: false,
      isLoading: false,
      connectionId: node.connectionId,
      databaseName: node.databaseName,
      schema: node.schema,
      tableName: node.tableName,
    }));
  }

  private async loadColumns(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const columns = await firstValueFrom(
      this.ipc.getTableColumns(node.connectionId, node.databaseName, node.schema, node.tableName)
    );

    return columns.map(col => {
      const typeDisplay = this.formatColumnType(col);
      const nullable = col.isNullable ? 'NULL' : 'NOT NULL';
      const pkIndicator = col.isPrimaryKey ? ' (PK)' : '';
      const fkIndicator = col.isForeignKey ? ' (FK)' : '';

      return {
        id: `${node.id}-col-${col.name}`,
        name: `${col.name} (${typeDisplay}, ${nullable})${pkIndicator}${fkIndicator}`,
        type: 'column' as NodeType,
        icon: col.isPrimaryKey ? 'key' : col.isForeignKey ? 'link' : this.iconMap['column'],
        path: `${node.path}/${col.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        columnInfo: col,
      };
    });
  }

  private async loadIndexes(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const indexes = await firstValueFrom(
      this.ipc.getTableIndexes(node.connectionId, node.databaseName, node.schema, node.tableName)
    );

    return indexes.map(idx => {
      const typeDisplay = idx.isPrimaryKey ? 'Primary Key' : idx.isUnique ? 'Unique' : idx.type;
      const columnsDisplay = idx.columns.join(', ');

      return {
        id: `${node.id}-idx-${idx.name}`,
        name: `${idx.name} (${typeDisplay}) [${columnsDisplay}]`,
        type: 'index' as NodeType,
        icon: idx.isPrimaryKey ? 'key' : this.iconMap['index'],
        path: `${node.path}/${idx.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        indexInfo: idx,
      };
    });
  }

  private async loadForeignKeys(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const foreignKeys = await firstValueFrom(
      this.ipc.getTableKeys(node.connectionId, node.databaseName, node.schema, node.tableName)
    );

    return foreignKeys.map(fk => {
      const refDisplay = `${fk.referencedSchema}.${fk.referencedTable}`;

      return {
        id: `${node.id}-fk-${fk.name}`,
        name: `${fk.name} → ${refDisplay}`,
        type: 'foreign_key' as NodeType,
        icon: this.iconMap['foreign_key'],
        path: `${node.path}/${fk.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        foreignKeyInfo: fk,
      };
    });
  }

  private async loadConstraints(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const constraints = await firstValueFrom(
      this.ipc.getTableConstraints(
        node.connectionId,
        node.databaseName,
        node.schema,
        node.tableName
      )
    );

    return constraints.map(con => {
      const typeDisplay = con.type.replace('_', ' ').toUpperCase();

      return {
        id: `${node.id}-con-${con.name}`,
        name: `${con.name} (${typeDisplay})`,
        type: 'constraint' as NodeType,
        icon: this.iconMap['constraint'],
        path: `${node.path}/${con.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        constraintInfo: con,
      };
    });
  }

  private async loadTriggers(node: TreeNode): Promise<TreeNode[]> {
    if (!node.connectionId || !node.databaseName || !node.schema || !node.tableName) {
      return [];
    }

    const triggers = await firstValueFrom(
      this.ipc.getTableTriggers(node.connectionId, node.databaseName, node.schema, node.tableName)
    );

    return triggers.map(trg => {
      const statusDisplay = trg.isEnabled ? '' : ' (Disabled)';

      return {
        id: `${node.id}-trg-${trg.name}`,
        name: `${trg.name}${statusDisplay}`,
        type: 'trigger' as NodeType,
        icon: this.iconMap['trigger'],
        path: `${node.path}/${trg.name}`,
        hasChildren: false,
        isExpanded: false,
        isLoading: false,
        connectionId: node.connectionId,
        databaseName: node.databaseName,
        schema: node.schema,
        tableName: node.tableName,
        triggerInfo: trg,
      };
    });
  }

  private formatColumnType(col: ColumnInfo): string {
    const type = col.dataType;
    if (['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(type)) {
      const len = col.maxLength === -1 ? 'MAX' : col.maxLength;
      return `${type}(${len})`;
    }
    if (['decimal', 'numeric'].includes(type)) {
      return `${type}(${col.precision},${col.scale})`;
    }
    return type;
  }

  private getDatabaseFolders(connectionId: string, databaseName: string): TreeNode[] {
    const folders = [
      { name: 'Tables', type: 'tables', icon: 'table_chart' },
      { name: 'Views', type: 'views', icon: 'view_list' },
      { name: 'Stored Procedures', type: 'procedures', icon: 'functions' },
      { name: 'Functions', type: 'functions', icon: 'calculate' },
    ];

    return folders.map(folder => ({
      id: `folder-${connectionId}-${databaseName}-${folder.type}`,
      name: folder.name,
      type: 'folder' as const,
      icon: folder.icon,
      path: folder.type,
      hasChildren: true,
      isExpanded: false,
      isLoading: false,
      connectionId,
      databaseName,
    }));
  }

  private metadataToNode(metadata: ObjectMetadata, parent: TreeNode): TreeNode {
    const type = metadata.type.toLowerCase() as NodeType;
    // Tables have sub-nodes for columns, indexes, etc.
    const hasChildren = type === 'table';

    return {
      id: `obj-${parent.connectionId}-${parent.databaseName}-${metadata.schema}.${metadata.name}`,
      name: metadata.schema ? `${metadata.schema}.${metadata.name}` : metadata.name,
      type,
      icon: this.iconMap[type] || 'description',
      path: `${parent.path}/${metadata.schema}.${metadata.name}`,
      hasChildren,
      isExpanded: false,
      isLoading: false,
      connectionId: parent.connectionId,
      databaseName: parent.databaseName,
      schema: metadata.schema,
      tableName: metadata.name,
      metadata,
    };
  }

  private findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.children) {
        const found = this.findNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  private updateNode(nodeId: string, updates: Partial<TreeNode>): void {
    this._rootNodes.update(nodes => this.updateNodeInTree(nodes, nodeId, updates));
  }

  private updateNodeInTree(
    nodes: TreeNode[],
    nodeId: string,
    updates: Partial<TreeNode>
  ): TreeNode[] {
    return nodes.map(node => {
      if (node.id === nodeId) {
        return { ...node, ...updates };
      }
      if (node.children) {
        return {
          ...node,
          children: this.updateNodeInTree(node.children, nodeId, updates),
        };
      }
      return node;
    });
  }
}
