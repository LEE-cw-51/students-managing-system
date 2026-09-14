import postgres from 'postgres';
import { loadEnv } from './env.js';

loadEnv();

let sql;

export function getSql() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL이 없습니다. .env.local을 확인하세요.');
  }
  sql = postgres(url, {
    ssl: 'require',
    max: 1,
    idle_timeout: 20,
    connect_timeout: 20,
    prepare: false
  });
  return sql;
}
