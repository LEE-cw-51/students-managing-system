// First admin account, owner of the default workspace (existing data).
// Only works while no account exists. Usage:
//   npm run create-admin -- admin@example.com "이름"
// Password: ADMIN_PASSWORD env var, otherwise asked on the terminal.

import readline from 'node:readline/promises';
import { bootstrapAdmin } from '../lib/accounts.js';
import { useFileStore } from '../lib/store.js';

async function askPassword() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question('비밀번호: ');
  } finally {
    rl.close();
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
