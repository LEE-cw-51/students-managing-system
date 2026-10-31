'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');
const { isPublicApi } = require('../lib/store.js');
const { PUBLIC_API } = require('../lib/public-api.js');

const ROOT = path.join(__dirname, '..');

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return sourceFiles(full);
    return /\.(js|jsx|ts|tsx)$/.test(d.name) ? [full] : [];
  });
}

function clientApiNames() {
  const names = new Set();
  ['app', 'components', 'lib'].forEach((dir) => {
    sourceFiles(path.join(ROOT, dir)).forEach((file) => {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/\bapi\(\s*'(\w+)'/g)) names.add(m[1]);
      for (const m of src.matchAll(/\bapi\([^,)]*\?\s*'(\w+)'\s*:\s*'(\w+)'/g)) { names.add(m[1]); names.add(m[2]); }
      for (const m of src.matchAll(/apiBatch\(\s*\[([\s\S]*?)\]\s*\)/g)) {
        for (const c of m[1].matchAll(/\[\s*'(\w+)'/g)) names.add(c[1]);
      }
    });
  });
  names.delete('apiBatch');
  return names;
}

describe('browser API allowlist', () => {
  const api = LMS.createService(createMemoryStore());

  it('lists exactly the service functions the client calls', () => {
    const used = clientApiNames();
    ['updateStudent', 'createStudent', 'updateClass', 'createClass', 'getSchoolExams', 'getSchoolOptions', 'getShellBootstrap'].forEach((n) => {
      assert.ok(used.has(n), n);
    });
    assert.deepEqual([...used].sort(), [...PUBLIC_API].sort());
    assert.equal(PUBLIC_API.size, 87);
  });

  it('only lists real service functions', () => {
    PUBLIC_API.forEach((n) => {
      assert.equal(typeof api[n], 'function', n);
      assert.equal(isPublicApi(api, n), true, n);
    });
  });

  it('keeps internal and unlisted functions off the browser API', () => {
    ['saveAiPlanDraft', 'getClassPlanContext', 'createSplitDraft', 'setDailyPlanDone', 'ensureSchema',
      'saveLesson', 'closeClass', 'saveAgentTurn', 'applyAgentProposal', 'markAgentProposalFailed',
      'previewAgentAction', 'getAgentHistory', 'getAgentContext', 'toString', 'constructor', 'hasOwnProperty', '__proto__', 'nope'].forEach((n) => {
      assert.equal(isPublicApi(api, n), false, n);
    });
  });
});
