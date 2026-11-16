// First admin account, owner of the default workspace (existing data).
// Only works while no account exists. Usage:
//   npm run create-admin -- admin@example.com "이름"
// Password: ADMIN_PASSWORD env var, otherwise asked on the terminal.

import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { bootstrapAdmin } from '../lib/accounts.js';
import { useFileStore } from '../lib/store.js';

// Reads the password without showing it: readline echoes typed keys to its output, which is muted
// once the prompt is written.
async function askPassword() {
  if (!process.stdin.isTTY) {
    throw new Error('터미널이 아니면 비밀번호를 물을 수 없습니다. ADMIN_PASSWORD 환경 변수로 넘겨 주세요.');
  }
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    }
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  try {
    const asked = rl.question('비밀번호(입력해도 화면에 보이지 않습니다): ');
    muted = true;
    return await asked;
  } finally {
    rl.close();
    process.stdout.write('\n');
  }
}

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  if (!email) {
    console.error('사용법: npm run create-admin -- admin@example.com "이름"');
    process.exit(1);
  }
  const password = process.env.ADMIN_PASSWORD || (await askPassword());
  const { user, workspaceId } = await bootstrapAdmin({ email, password, name: nameParts.join(' ') });
  console.log(`관리자 계정을 만들었습니다: ${user.email} (작업공간 ${workspaceId})`);
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!useFileStore() && process.env.DATABASE_URL) {
      const { getSql } = await import('../lib/db.js');
      await getSql().end({ timeout: 5 });
    }
  });
