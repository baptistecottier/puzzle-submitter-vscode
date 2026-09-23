import { PuzzleContext, PuzzleProvider } from '../types';

/** Highest part number for THIS specific puzzle — usually the provider's general
 * maxPart, except where a provider overrides it per-puzzle (e.g. Advent of Code's last
 * day of the event has only one part, and which day counts as "last" changed in 2025). */
export function maxPartFor(provider: PuzzleProvider, ctx: PuzzleContext): number {
  return provider.maxPartFor ? provider.maxPartFor(ctx) : provider.maxPart;
}
