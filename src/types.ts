import * as vscode from 'vscode';

export type SiteId = 'aoc' | 'everybodycodes' | 'codyssi' | 'i18n-puzzles' | 'codingquest';

export interface PuzzleContext {
  /** Event year, story number, etc. — whatever the site groups puzzles by. Empty string if the site has none (e.g. i18n-puzzles). */
  group: string;
  /** Day / quest / puzzle number, as it appears in the site's own numbering (not zero-padded). */
  index: string;
  /** 1-based part/level within the puzzle. */
  part: number;
}

export type SubmitStatus = 'correct' | 'incorrect' | 'already-solved' | 'rate-limited' | 'unknown';

export interface SubmitResult {
  status: SubmitStatus;
  message: string;
}

/** Raw input text per part number ("1", "2", "3", ...) — the one local-storage shape
 * every provider reads/writes, regardless of how each site's own API/UI hands it out. */
export type PuzzleInputParts = Record<string, string>;

/** How a site's real solver(data) expects to receive PuzzleInputParts once loaded. */
export type SolverInputShape =
  | 'text' // solver(data: str) — data is the single relevant part's text (aoc, codyssi, i18n-puzzles, codingquest)
  | 'parts-dict'; // solver(data: dict[int, str]) — data is every fetched part at once (everybodycodes)

export interface PuzzleProvider {
  id: SiteId;
  label: string;
  /** Shown when prompting the user to paste their session token. */
  tokenPrompt: string;
  /** Highest part number this site's puzzles have (used for the "next unsolved part" default). */
  maxPart: number;
  /** Infer year/day/quest + a default part from a file path relative to the workspace root. */
  detect(relativeFilePath: string): PuzzleContext | undefined;
  /** Link to the puzzle's page on the site, for a human to open. */
  puzzleUrl(ctx: PuzzleContext): string;
  /** Only implemented by sites with a known submission API (aoc, everybodycodes). Returns
   * every part fetchable in one go, not just the requested one. */
  fetchInput?(ctx: PuzzleContext, token: string, contact: string): Promise<PuzzleInputParts>;
  submit?(ctx: PuzzleContext, token: string, answer: string, contact: string): Promise<SubmitResult>;
  /** Workspace-relative path this puzzle's local input is cached at. */
  localInputPath(ctx: PuzzleContext): string;
  /** Reads whatever's cached locally for this puzzle, if anything. */
  readLocalInput(ctx: PuzzleContext, folder: vscode.WorkspaceFolder): PuzzleInputParts | undefined;
  /** Merges `parts` into whatever's already cached (doesn't drop other parts already saved). */
  writeLocalInput(ctx: PuzzleContext, folder: vscode.WorkspaceFolder, parts: PuzzleInputParts): void;
  /** Set on every site: how its solver(data) wants PuzzleInputParts shaped. Presence of
   * this field is what enables the "Run solver() from this file" runner. */
  solverInputShape?: SolverInputShape;
}
