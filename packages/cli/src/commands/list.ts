import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { table, getBorderCharacters } from 'table';
import {
  getDatabases,
  getTables,
  isConnected,
  formatError,
} from '../utils/database';
import { printError, printInfo } from '../utils/output';

export const listCommand = new Command('list')
  .alias('ls')
  .description('List databases, tables, or other objects')
  .argument('[type]', 'Type to list: databases, tables, views, procedures', 'databases')
  .option('-d, --database <name>', 'Database to use for tables/views/procedures')
  .action(async (type, options) => {
    if (!isConnected()) {
      printError('Not connected to a database.');
      printInfo('Use "forge connect" to establish a connection first.');
      process.exit(1);
    }

    const spinner = ora(`Loading ${type}...`).start();

    try {
      switch (type.toLowerCase()) {
        case 'databases':
        case 'dbs':
        case 'db':
          await listDatabases(spinner);
          break;

        case 'tables':
        case 'tbl':
          await listTables(spinner, options.database);
          break;

        case 'views':
        case 'v':
          await listViews(spinner, options.database);
          break;

        case 'procedures':
        case 'procs':
        case 'sp':
          await listProcedures(spinner, options.database);
          break;

        default:
          spinner.fail(`Unknown type: ${type}`);
          printInfo('Valid types: databases, tables, views, procedures');
          process.exit(1);
      }
    } catch (error) {
      spinner.fail('Failed to load');
      printError(formatError(error));
      process.exit(1);
    }
  });

async function listDatabases(spinner: ReturnType<typeof ora>): Promise<void> {
  const databases = await getDatabases();
  spinner.succeed(`Found ${databases.length} databases`);
  console.log('');

  const tableData = [
    [chalk.bold.cyan('Database')],
    ...databases.map(db => [db]),
  ];

  console.log(
    table(tableData, {
      border: getBorderCharacters('norc'),
      drawHorizontalLine: (lineIndex, rowCount) =>
        lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
    })
  );
}

async function listTables(
  spinner: ReturnType<typeof ora>,
  database?: string
): Promise<void> {
  const tables = await getTables(database);
  spinner.succeed(`Found ${tables.length} tables`);
  console.log('');

  if (tables.length === 0) {
    printInfo('No tables found');
    return;
  }

  const tableData = [
    [chalk.bold.cyan('Schema'), chalk.bold.cyan('Table')],
    ...tables.map(t => [t.schema, t.name]),
  ];

  console.log(
    table(tableData, {
      border: getBorderCharacters('norc'),
      drawHorizontalLine: (lineIndex, rowCount) =>
        lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
    })
  );
}

async function listViews(
  spinner: ReturnType<typeof ora>,
  database?: string
): Promise<void> {
  // Similar to tables but for views
  const db = database ? `[${database}].` : '';

  // This would need to be added to database.ts, but for now use inline query
  spinner.text = 'Loading views...';

  // For now, show a placeholder
  spinner.succeed('Views listing');
  printInfo('Use "forge query" to explore views with:');
  console.log(
    chalk.dim(`  SELECT s.name AS [schema], v.name AS [view]
  FROM ${db}sys.views v
  INNER JOIN ${db}sys.schemas s ON v.schema_id = s.schema_id
  ORDER BY s.name, v.name`)
  );
}

async function listProcedures(
  spinner: ReturnType<typeof ora>,
  database?: string
): Promise<void> {
  const db = database ? `[${database}].` : '';

  spinner.succeed('Stored procedures listing');
  printInfo('Use "forge query" to explore procedures with:');
  console.log(
    chalk.dim(`  SELECT s.name AS [schema], p.name AS [procedure]
  FROM ${db}sys.procedures p
  INNER JOIN ${db}sys.schemas s ON p.schema_id = s.schema_id
  ORDER BY s.name, p.name`)
  );
}
