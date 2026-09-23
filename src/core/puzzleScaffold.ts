import { PuzzleContext, PuzzleProvider } from '../types';

function pad(index: string): string {
  return index.padStart(2, '0');
}

/**
 * Given a puzzle already known to exist somewhere in the workspace, works out any path
 * prefix the real file has that the provider's own canonical scaffoldPath() doesn't
 * account for (e.g. a repo that nests everything under "src/everybodycodes/" instead of
 * putting "events/" at the workspace root). Returns "" when nothing to infer, or the
 * canonical path doesn't actually match the end of the real one.
 */
export function inferPathPrefix(provider: PuzzleProvider, existingCtx: PuzzleContext, existingRelativePath: string): string {
  const canonical = provider.scaffoldPath?.(existingCtx);
  if (canonical && existingRelativePath.endsWith(canonical)) {
    return existingRelativePath.slice(0, existingRelativePath.length - canonical.length);
  }
  return '';
}

/** The "Other" escape hatch: a generic AoC-shaped layout for when you want to deviate
 * from the active site's real convention. Not guaranteed to be picked up by any
 * provider's detect() — that's the tradeoff for using a custom noun. */
export function genericScaffoldPath(group: string, noun: string, index: string): string {
  const folder = `${noun}_${pad(index)}`;
  return `events/${group}/${folder}/${folder}.py`;
}

/** Docstring header + a minimal preprocessing()/solver() stub, matching the calling
 * convention every provider's real runner expects (see core/pythonRunner.ts). */
export function scaffoldFileContent(provider: PuzzleProvider, ctx: PuzzleContext): string {
  const group = provider.groupLabel ? provider.groupLabel(ctx.group) : ctx.group;
  const header = [provider.label, group, `${provider.itemNoun} ${ctx.index}`].filter(Boolean).join(' - ');
  return `"""
${header}
${provider.puzzleUrl(ctx)}
"""


def preprocessing(data):
    return data


def solver(data):
    raise NotImplementedError
`;
}

export interface NewEventPlan {
  relativePath: string;
  ctx: PuzzleContext;
}

/**
 * Builds the target path for each new puzzle 1..count. When `noun` matches the
 * provider's own itemNoun, uses its real scaffoldPath() (plus any inferred prefix) so
 * the tree will actually pick the result up. Any other noun is the deliberate "Other"
 * escape hatch — a generic layout instead, with no such guarantee.
 */
export function planNewEvent(
  provider: PuzzleProvider,
  group: string,
  noun: string,
  count: number,
  prefix: string
): NewEventPlan[] {
  const usesSiteConvention = provider.scaffoldPath && noun === provider.itemNoun;
  const plan: NewEventPlan[] = [];
  for (let i = 1; i <= count; i++) {
    const index = String(i);
    const ctx: PuzzleContext = { group, index, part: 1 };
    const relativePath = usesSiteConvention
      ? prefix + provider.scaffoldPath!(ctx)
      : genericScaffoldPath(group, noun, index);
    plan.push({ relativePath, ctx });
  }
  return plan;
}
