import { PuzzleProvider, SiteId } from '../types';
import { aocProvider } from './aoc';
import { everybodyCodesProvider } from './everybodycodes';
import { codyssiProvider, i18nPuzzlesProvider, codingQuestProvider } from './assistProvider';

export const providers: Record<SiteId, PuzzleProvider> = {
  aoc: aocProvider,
  everybodycodes: everybodyCodesProvider,
  codyssi: codyssiProvider,
  'i18n-puzzles': i18nPuzzlesProvider,
  codingquest: codingQuestProvider,
};

export const allProviders: PuzzleProvider[] = Object.values(providers);
