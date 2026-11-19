import { PuzzleProvider, SiteId } from '../types';
import { aocProvider } from './aoc';
import { everybodyCodesProvider } from './everybodycodes';
import { codyssiProvider, codingQuestProvider } from './assistProvider';
import { i18nPuzzlesProvider } from './i18nPuzzles';
import { systemsCheckProvider } from './systemsCheck';

export const providers: Record<SiteId, PuzzleProvider> = {
  aoc: aocProvider,
  everybodycodes: everybodyCodesProvider,
  codyssi: codyssiProvider,
  'i18n-puzzles': i18nPuzzlesProvider,
  codingquest: codingQuestProvider,
  systemscheck: systemsCheckProvider,
};

export const allProviders: PuzzleProvider[] = Object.values(providers);
