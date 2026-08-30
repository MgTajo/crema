/* What accounts.setup.js left behind, for the specs to read. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = path.resolve(HERE, '../.auth');
export const STATE_A  = path.join(AUTH_DIR, 'a.json');

export function accounts() {
  const f = path.join(AUTH_DIR, 'accounts.json');
  if (!fs.existsSync(f)) throw new Error(`${f} is missing — the "setup" project did not run.`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
