/**
 * Database-related type definitions
 */

export type DatabaseState = 'online' | 'offline' | 'restoring' | 'recovering' | 'suspect';
export type RecoveryModel = 'simple' | 'full' | 'bulk_logged';
export type ObjectType =
  | 'database'
  | 'table'
  | 'view'
  | 'procedure'
  | 'function'
  | 'index'
  | 'trigger'
  | 'column';

export interface DatabaseInfo {
  name: string;
  databaseId?: number;
  sizeBytes?: number;
  sizeMB?: number;
  state: DatabaseState;
  recoveryModel?: RecoveryModel;
  collation?: string;
  compatibilityLevel?: number;
  isSystemDb?: boolean;
  createdAt?: string;
  lastBackupDate?: string;
  lastLogBackupDate?: string;
}

export interface CreateDatabaseOptions {
  name: string;
  collation?: string;
  recoveryModel?: RecoveryModel;
}

export interface RenameDatabaseOptions {
  currentName: string;
  newName: string;
  closeConnections?: boolean;
}

export interface DeleteDatabaseOptions {
  name: string;
  closeConnections?: boolean;
}

// Unified result type for database operations
export interface DatabaseOperationResult {
  success: boolean;
  /** The SQL statement that was executed (T-SQL, PL/pgSQL, or MySQL) */
  tsql: string;
  error?: string;
  message?: string;
}

// Legacy aliases
export type CreateDatabaseResult = DatabaseOperationResult;
export type RenameDatabaseResult = DatabaseOperationResult;
export type DeleteDatabaseResult = DatabaseOperationResult;

export interface SchemaInfo {
  name: string;
  owner?: string;
  isSystem: boolean;
}

export interface TableInfo {
  schema: string;
  name: string;
  rowCount?: number;
  sizeKb?: number;
  createdAt?: string;
}

export interface ViewInfo {
  schema: string;
  name: string;
  createdAt?: string;
}

export interface ProcedureInfo {
  schema: string;
  name: string;
  createdAt?: string;
  modifiedAt?: string;
}

export interface FunctionInfo {
  schema: string;
  name: string;
  type: 'Scalar' | 'Table-valued' | 'Inline Table-valued';
  createdAt?: string;
  modifiedAt?: string;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  maxLength?: number;
  precision?: number;
  scale?: number;
  isNullable: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  defaultValue?: string;
  ordinalPosition: number;
}

export interface IndexInfo {
  name: string;
  type: 'clustered' | 'nonclustered' | 'unique' | 'primary' | 'xml' | 'spatial';
  columns: string[];
  isUnique: boolean;
  isPrimaryKey?: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedSchema: string;
  referencedColumns: string[];
  onDelete?: 'no_action' | 'cascade' | 'set_null' | 'set_default';
  onUpdate?: 'no_action' | 'cascade' | 'set_null' | 'set_default';
}

export interface ConstraintInfo {
  name: string;
  type: 'primary_key' | 'foreign_key' | 'unique' | 'check' | 'default';
  columns: string[];
  definition?: string;
}

export interface TriggerInfo {
  name: string;
  isEnabled: boolean;
  triggerType: 'insert' | 'update' | 'delete' | 'instead_of';
  createdAt?: string;
}

export interface TableMetadata {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  constraints: ConstraintInfo[];
  triggers: TriggerInfo[];
  rowCount?: number;
  sizeKb?: number;
  createdAt?: string;
}

export interface ObjectMetadata {
  name: string;
  type: ObjectType | string;
  schema: string;
  database?: string;
  definition?: string;
  columns?: ColumnInfo[];
  indexes?: IndexInfo[];
  createdAt?: string;
  modifiedAt?: string;
}

export interface ObjectDefinition {
  objectType: 'table' | 'view' | 'procedure' | 'function';
  schema: string;
  name: string;
  definition: string;
}

/**
 * Extended Property - SQL Server's way of adding documentation/metadata to objects
 * See: sp_addextendedproperty, fn_listextendedproperty
 */
export interface ExtendedProperty {
  name: string;
  value: string;
  level0Type?: string; // 'SCHEMA'
  level0Name?: string; // schema name
  level1Type?: string; // 'TABLE', 'VIEW', etc.
  level1Name?: string; // object name
  level2Type?: string; // 'COLUMN', 'INDEX', etc.
  level2Name?: string; // column/index name
}

/**
 * Comprehensive table properties including storage, space, and metadata
 */
export interface TableProperties {
  // Basic Info
  schema: string;
  name: string;
  objectId: number;
  createdAt: string;
  modifiedAt?: string;

  // Storage & Space
  rowCount: number;
  dataSpaceKb: number;
  indexSpaceKb: number;
  unusedSpaceKb: number;
  totalSpaceKb: number;

  // Table Settings
  hasIdentity: boolean;
  identityColumn?: string;
  identitySeed?: number;
  identityIncrement?: number;
  isReplicated: boolean;
  hasTextImage: boolean;
  textImageOnFilegroup?: string;
  filegroup: string;

  // Additional metadata
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
  constraints: ConstraintInfo[];
  triggers: TriggerInfo[];
  extendedProperties: ExtendedProperty[];
}

/**
 * MemberJunction Database Detection
 * When a database has an __mj schema with Entity/EntityField tables,
 * it's an MJ-enabled database with rich metadata we can leverage.
 */
export interface MJDatabaseInfo {
  /** Whether this database has MJ installed */
  isMJEnabled: boolean;
  /** The MJ core schema name (typically '__mj') */
  schemaName?: string;
  /** MJ version if detectable */
  version?: string;
  /** Number of entities defined in MJ */
  entityCount?: number;
  /** Number of applications defined in MJ */
  applicationCount?: number;
  /** Whether user management is available */
  hasUsers?: boolean;
  /** Whether audit logging is enabled */
  hasAuditLog?: boolean;
}

/**
 * MemberJunction Entity metadata from __mj.Entity table
 */
export interface MJEntityInfo {
  id: string;
  name: string;
  description?: string;
  baseTable: string;
  baseView?: string;
  schemaName: string;
  isVirtual: boolean;
  trackRecordChanges: boolean;
  auditRecordAccess: boolean;
  includeInAPI: boolean;
  allowCreateAPI: boolean;
  allowUpdateAPI: boolean;
  allowDeleteAPI: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * MemberJunction EntityField metadata from __mj.EntityField table
 */
export interface MJEntityFieldInfo {
  id: string;
  entityId: string;
  name: string;
  displayName?: string;
  description?: string;
  type: string;
  length?: number;
  precision?: number;
  scale?: number;
  allowsNull: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  defaultValue?: string;
  isVirtual: boolean;
  sequence: number;
  relatedEntityId?: string;
  relatedEntityFieldName?: string;
}

/**
 * MemberJunction Application metadata
 */
export interface MJApplicationInfo {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

/**
 * MemberJunction Record Change from __mj.RecordChange table
 * Tracks field-level changes to records
 */
export interface MJRecordChange {
  id: string;
  entityId: string;
  entityName?: string;
  recordId: string;
  type: 'Create' | 'Update' | 'Delete';
  source: string;
  changesJSON?: string;
  changesDescription?: string;
  fullRecordJSON?: string;
  status: string;
  comments?: string;
  createdAt: string;
  userId?: string;
  userName?: string;
}

/**
 * MemberJunction Audit Log entry from __mj.AuditLog table
 */
export interface MJAuditLog {
  id: string;
  userId?: string;
  userName?: string;
  auditLogTypeName?: string;
  status: 'Allow' | 'Deny';
  entityId?: string;
  entityName?: string;
  recordId?: string;
  description?: string;
  details?: string;
  createdAt: string;
}

/**
 * MemberJunction Saved Query from __mj.Query table
 */
export interface MJQuery {
  id: string;
  name: string;
  description?: string;
  categoryId?: string;
  categoryName?: string;
  sql: string;
  originalSQL?: string;
  feedback?: string;
  status: string;
  qualityRank?: number;
  createdAt: string;
  updatedAt?: string;
}

/**
 * MemberJunction Error Log entry from __mj.ErrorLog table
 */
export interface MJErrorLog {
  id: string;
  code?: string;
  message?: string;
  category?: string;
  status?: string;
  details?: string;
  createdBy?: string;
  createdAt: string;
}

/**
 * MemberJunction User Record Log from __mj.UserRecordLog table
 * Tracks which users accessed which records
 */
export interface MJUserRecordLog {
  id: string;
  userId: string;
  userName?: string;
  entityId: string;
  entityName?: string;
  recordId: string;
  earliestAt: string;
  latestAt: string;
  totalCount: number;
}

/**
 * MemberJunction Entity Relationship from __mj.EntityRelationship table
 */
export interface MJEntityRelationship {
  id: string;
  entityId: string;
  entityName?: string;
  relatedEntityId: string;
  relatedEntityName?: string;
  bundleInAPI: boolean;
  type: string;
  displayName?: string;
  displayInForm: boolean;
  displayLocation: string;
  sequence: number;
}
