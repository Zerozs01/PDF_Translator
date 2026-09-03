import type Database from 'better-sqlite3-multiple-ciphers';

import { DocumentDAO } from './DocumentDAO';
import { ProjectDAO } from './ProjectDAO';
import { TagDAO } from './TagDAO';
import { OCRCacheDAO, OCRDAO } from './OCRCacheDAO';
import { TranslationCacheDAO, SentenceTranslationDAO, TranslationDAO } from './TranslationDAO';
import { GlossaryDAO } from './GlossaryDAO';
import { BenchmarkDAO } from './BenchmarkDAO';

export {
  DocumentDAO,
  ProjectDAO,
  TagDAO,
  OCRCacheDAO,
  OCRDAO,
  TranslationCacheDAO,
  SentenceTranslationDAO,
  TranslationDAO,
  GlossaryDAO,
  BenchmarkDAO,
};

export function initAllDAOs(db: Database.Database): void {
  DocumentDAO.init(db);
  ProjectDAO.init(db);
  TagDAO.init(db);
  OCRCacheDAO.init(db);
  TranslationCacheDAO.init(db);
  SentenceTranslationDAO.init(db);
  GlossaryDAO.init(db);
  BenchmarkDAO.init(db);
}
