import { run } from './exec.js';

/**
 * The codegen "convention tripwire" (ADR-009).
 *
 * After the setup loop's codegen runs, we git-diff exactly the directories codegen
 * writes to. A non-empty diff means generated code changed — i.e. the committed
 * generated code did NOT already match the committed migrations (the convention is
 * broken), or the developer hand-edited a generated file. Either way it's a
 * non-blocking warning the caller surfaces.
 *
 * We scope the diff to codegen's OWN output dirs, read from the worktree's resolved
 * mj config (`output[].directory` + `SQLOutput.folderPath`), so it auto-adapts when
 * MJ adds a new generated folder. `**\/generated\/**` is only a fallback. git's own
 * `.gitignore` drops untracked-but-ignored generated trees (e.g. `SQL Scripts/generated`).
 */

/**
 * Read codegen's output directories from a worktree's resolved mj config by
 * `require`-ing it in a short-lived node process (the config is CJS and may have
 * side effects, so we don't import it into our ESM process). Returns directories
 * relative to `configCwd`, plus the SQL migration output dir. Returns [] on any
 * failure — callers then fall back to a `generated/` glob.
 */
export async function readCodegenOutputDirs(
  configCwd: string,
  configPath: string
): Promise<string[]> {
  const evalSrc =
    'try{' +
    `const c=require(${JSON.stringify(configPath)});` +
    'const out=Array.isArray(c.output)?c.output.map(o=>o&&o.directory).filter(Boolean):[];' +
    'const sql=(c.SQLOutput&&c.SQLOutput.folderPath)?[c.SQLOutput.folderPath]:[];' +
    'process.stdout.write(JSON.stringify(out.concat(sql)));' +
    "}catch(e){process.stdout.write('[]')}";
  const res = await run('node', ['-e', evalSrc], { cwd: configCwd });
  try {
    const arr = JSON.parse((res.stdout || '[]').trim() || '[]');
    return Array.isArray(arr) ? arr.filter((d: unknown): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

export interface DriftResult {
  changed: boolean;
  files: string[];
}

/**
 * Detect whether codegen changed any generated files by `git status --porcelain`
 * scoped to `dirs` (config-derived) inside `gitRoot`. `--porcelain` catches both
 * modified tracked files and new untracked (non-ignored) ones. When `dirs` is
 * empty, falls back to a `**\/generated\/**` glob pathspec. Returns the changed
 * paths (capped). Never throws — git failure ⇒ no drift reported.
 */
export async function detectGeneratedDrift(gitRoot: string, dirs: string[]): Promise<DriftResult> {
  const pathspecs = dirs.length > 0 ? dirs : [':(glob)**/generated/**'];
  const res = await run('git', ['status', '--porcelain', '--', ...pathspecs], { cwd: gitRoot });
  if (res.code !== 0) return { changed: false, files: [] };
  const files = res.stdout
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.trim().length > 0)
    // Strip the 2-char XY status + following space(s): " M path", "?? path", "A  path".
    .map(l => l.slice(3).trim())
    // A rename shows "old -> new"; keep the new path.
    .map(l => (l.includes(' -> ') ? l.split(' -> ').pop()! : l));
  return { changed: files.length > 0, files: files.slice(0, 50) };
}
