import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
];

const seen = new Set();

for (const envPath of candidates) {
  const normalised = path.resolve(envPath);
  if (seen.has(normalised) || !fs.existsSync(normalised)) continue;
  dotenv.config({ path: normalised, override: false });
  seen.add(normalised);
}
