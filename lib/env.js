import fs from 'node:fs';
import path from 'node:path';

let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;
  const file = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    const key = trimmed.slice(0, i);
    const value = trimmed.slice(i + 1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv();
