import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Config = {
  dataDir: string;
  port: number;
  workbook: string;
  sheets: { lists: Record<string, string>; alignments: Record<string, string> };
  asOf: string;
  /** Misspelled names in source data → canonical name. Customer-specific: keep in esh.config.local.json. */
  personAliases?: Record<string, string>;
  /** Demo seeding choices tied to a customer's real projects. Customer-specific: keep in esh.config.local.json. */
  demo?: { flagshipTitle?: string; keepUnseeded?: string[]; gate3Flagship?: string; gate3Predecessor?: string };
};

const base = JSON.parse(readFileSync(resolve(ROOT, 'esh.config.json'), 'utf8')) as Config;
const localPath = resolve(ROOT, 'esh.config.local.json');
const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : {};

export const config: Config = { ...base, ...local };
/** "Today" for rules (PoP-ending alerts etc.). Fixed in config so the demo is reproducible. */
export const AS_OF = new Date(config.asOf + 'T00:00:00Z');
