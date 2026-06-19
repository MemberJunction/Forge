import { spawn, type SpawnOptions } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions extends SpawnOptions {
  /** Called for each chunk of combined stdout/stderr as it arrives. */
  onOutput?: (chunk: string) => void;
}

/**
 * Run a command to completion, capturing output. Rejects only on spawn error
 * (e.g. binary not found); a non-zero exit resolves with `code` set so callers
 * decide how to react.
 */
export function run(cmd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const { onOutput, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...spawnOptions, shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      onOutput?.(s);
    });
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      onOutput?.(s);
    });

    child.on('error', reject);
    child.on('close', code => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Like {@link run} but throws if the command exits non-zero. */
export async function runOrThrow(
  cmd: string,
  args: string[],
  options: RunOptions = {}
): Promise<RunResult> {
  const result = await run(cmd, args, options);
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-5).join('\n');
    throw new Error(
      `\`${cmd} ${args.join(' ')}\` exited ${result.code}${detail ? `:\n${detail}` : ''}`
    );
  }
  return result;
}
