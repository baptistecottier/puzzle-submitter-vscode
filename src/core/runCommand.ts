import * as cp from 'node:child_process';
import * as vscode from 'vscode';
import { PuzzleContext } from '../types';

export function getConfiguredRunCommand(scope: vscode.ConfigurationScope | undefined): string {
  return vscode.workspace.getConfiguration('puzzleSubmitter', scope).get<string>('runCommand', '').trim();
}

function substitute(template: string, ctx: PuzzleContext, file: string): string {
  return template
    .replaceAll('${year}', ctx.group)
    .replaceAll('${day}', ctx.index)
    .replaceAll('${part}', String(ctx.part))
    .replaceAll('${file}', file);
}

/** Runs the configured command and returns the last non-empty line of stdout as the answer. */
export function runCommandForAnswer(
  template: string,
  ctx: PuzzleContext,
  file: string,
  cwd: string | undefined
): Promise<string> {
  const command = substitute(template, ctx, file);
  return new Promise((resolve, reject) => {
    cp.exec(command, { cwd, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed: ${error.message}${stderr ? `\n${stderr}` : ''}`));
        return;
      }
      const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
      const answer = lines.at(-1);
      if (!answer) {
        reject(new Error('Command produced no output to use as an answer.'));
        return;
      }
      resolve(answer);
    });
  });
}
