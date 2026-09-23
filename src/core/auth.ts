import * as vscode from 'vscode';
import { PuzzleProvider } from '../types';

function secretKey(siteId: string): string {
  return `puzzleSubmitter.token.${siteId}`;
}

export async function getToken(secrets: vscode.SecretStorage, provider: PuzzleProvider): Promise<string | undefined> {
  return secrets.get(secretKey(provider.id));
}

export async function requireToken(
  secrets: vscode.SecretStorage,
  provider: PuzzleProvider
): Promise<string | undefined> {
  const existing = await getToken(secrets, provider);
  if (existing) {
    return existing;
  }
  return promptAndSaveToken(secrets, provider);
}

export async function promptAndSaveToken(
  secrets: vscode.SecretStorage,
  provider: PuzzleProvider
): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: `${provider.label} session token`,
    prompt: provider.tokenPrompt,
    password: true,
    ignoreFocusOut: true,
  });
  if (!value) {
    return undefined;
  }
  await secrets.store(secretKey(provider.id), value.trim());
  return value.trim();
}

export async function clearToken(secrets: vscode.SecretStorage, provider: PuzzleProvider): Promise<void> {
  await secrets.delete(secretKey(provider.id));
}
