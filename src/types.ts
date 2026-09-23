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
  /** Only implemented by sites with a known submission API (aoc, everybodycodes). */
  fetchInput?(ctx: PuzzleContext, token: string, contact: string): Promise<string>;
  submit?(ctx: PuzzleContext, token: string, answer: string, contact: string): Promise<SubmitResult>;
  /** Workspace-relative path fetchInput's result should be written to. Required alongside fetchInput. */
  inputPath?(ctx: PuzzleContext): string;
}
