'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');
const {
  APP_SESSION, MCP_CONNECTOR, PROPOSAL_APP_ONLY, PROPOSAL_BAD_REQUEST, PROPOSAL_BATCH_MAX, propose, apply, reject
} = require('../lib/proposals.js');
const { errorDetails } = require('../lib/api-error.js');
const { isPublicApi } = require('../lib/store.js');

// Everything goes through the module interface; the store is only read to check the outcome.
function setup() {
  const store = createMemoryStore();
  const demo = seedDemo(LMS.createService(store));
  const run = async (fn) => fn(LMS.createService(store));
  const [hong] = demo.students;
  const tasks = (title) => store.readTable('Tasks').filter((t) => t.title === title).length;
  const row = (id) => store.readTable('AgentProposals').find((p) => p.proposal_id === id);
  const task = (title) => ({ tool: 'create_task', args: { due_date: '2026-09-20', kind: 'admin', title } });
  const proposeTask = async (title, caller = APP_SESSION) => (await propose(caller, { message: `${title} 추가`, reply: '확인해 주세요.', calls: [task(title)] }, run)).message.proposal;
  return { store, run, hong, tasks, row, task, proposeTask };
}

const ALREADY = '이미 처리된 제안입니다.';

describe('proposals: propose', () => {
  it('saves a pending proposal from the app without changing data', async () => {
    const { run, tasks, row, task } = setup();
    const saved = await propose(APP_SESSION, { message: '교재 주문 할 일', reply: '승인해 주세요.', calls: [task('교재 주문')] }, run);
    const p = saved.message.proposal;
    assert.equal(p.status, 'pending');
    assert.equal(p.calls.length, 1);
    assert.equal(saved.user_message.content, '교재 주문 할 일');
    assert.equal(row(p.proposal_id).source, 'assistant');
    assert.equal(tasks('교재 주문'), 0);
  });

  it('gives connector turns the connector message and source', async () => {
    const { run, row, task } = setup();
    const saved = await propose(MCP_CONNECTOR, { message: '무시됨', calls: [task('교재 주문')] }, run);
    const p = saved.message.proposal;
    assert.equal(row(p.proposal_id).source, 'mcp');
    assert.equal(saved.user_message.content, `${LMS.MCP_MESSAGE_PREFIX} ${p.calls[0].text}`);
    assert.equal(saved.message.content, '아래 변경 내용을 확인하고 승인해 주세요.');
  });

  it('refuses an invalid change and saves nothing', async () => {
    const { store, run } = setup();
    await assert.rejects(propose(MCP_CONNECTOR, { calls: [{ tool: 'update_attendance', args: { lesson_id: 'LES-9999', attendance: '결석' } }] }, run), /찾을 수 없습니다/);
    assert.equal(store.readTable('AgentProposals').length, 0);
    assert.equal(store.readTable('AgentConversations').length, 0);
  });

  it('saves a turn without changes and no proposal', async () => {
    const { store, run } = setup();
    const saved = await propose(APP_SESSION, { message: '안녕', reply: '안녕하세요.', calls: [] }, run);
    assert.equal(saved.message.proposal, null);
    assert.equal(store.readTable('AgentProposals').length, 0);
  });
});

describe('proposals: apply and reject from the app', () => {
  it('create → apply saves the change and records the outcome', async () => {
    const { run, tasks, row, proposeTask } = setup();
    const p = await proposeTask('교재 주문');
    const applied = await apply(APP_SESSION, { proposal_id: p.proposal_id }, run);
    assert.equal(applied.status, 'applied');
    assert.equal(applied.verification_status, 'verified');
    assert.ok(applied.executed_at);
    assert.equal(applied.result.length, 1);
    assert.equal(tasks('교재 주문'), 1);
    assert.equal(row(p.proposal_id).status, 'applied');
  });

  it('create → reject changes nothing', async () => {
    const { run, tasks, row, proposeTask } = setup();
    const p = await proposeTask('거절할 일');
    const rejected = await reject(APP_SESSION, { proposal_id: p.proposal_id }, run);
    assert.equal(rejected.status, 'rejected');
    assert.ok(rejected.executed_at);
    assert.equal(tasks('거절할 일'), 0);
    assert.equal(row(p.proposal_id).status, 'rejected');
  });

  it('applying twice runs once; rejecting twice is harmless', async () => {
    const { run, tasks, proposeTask } = setup();
    const a = await proposeTask('한 번만');
    const first = await apply(APP_SESSION, { proposal_id: a.proposal_id }, run);
    const again = await apply(APP_SESSION, { proposal_id: a.proposal_id }, run);
    assert.deepEqual(again, first);
    assert.equal(tasks('한 번만'), 1);

    const b = await proposeTask('거절');
    const r1 = await reject(APP_SESSION, { proposal_id: b.proposal_id }, run);
    const r2 = await reject(APP_SESSION, { proposal_id: b.proposal_id }, run);
    assert.deepEqual(r2, r1);
  });

  it('a settled proposal cannot be decided the other way, with the existing message', async () => {
    const { run, tasks, row, proposeTask } = setup();
    const a = await proposeTask('반영됨');
    await apply(APP_SESSION, { proposal_id: a.proposal_id }, run);
    await assert.rejects(reject(APP_SESSION, { proposal_id: a.proposal_id }, run), new RegExp(ALREADY));
    assert.equal(row(a.proposal_id).status, 'applied');

    const b = await proposeTask('거절됨');
    await reject(APP_SESSION, { proposal_id: b.proposal_id }, run);
    await assert.rejects(apply(APP_SESSION, { proposal_id: b.proposal_id }, run), new RegExp(ALREADY));
    assert.equal(row(b.proposal_id).status, 'rejected');
    assert.equal(row(b.proposal_id).result, null);
    assert.equal(tasks('거절됨'), 0);
  });

  it('a failed apply is recorded and then counts as handled', async () => {
    const { store, run, hong, row } = setup();
    const lesson = store.readTable('Lessons').find((l) => l.student_id === hong.student_id);
    const saved = await propose(APP_SESSION, { message: '결석', reply: '확인', calls: [{ tool: 'update_attendance', args: { lesson_id: lesson.lesson_id, attendance: '결석' } }] }, run);
    const id = saved.message.proposal.proposal_id;
    store.writeTable('Lessons', store.readTable('Lessons').filter((l) => l.lesson_id !== lesson.lesson_id));
    await assert.rejects(apply(APP_SESSION, { proposal_id: id }, run), /찾을 수 없습니다/);
    assert.equal(row(id).status, 'failed');
    assert.match(row(id).result.error, /찾을 수 없습니다/);
    await assert.rejects(apply(APP_SESSION, { proposal_id: id }, run), new RegExp(ALREADY));
    assert.match(row(id).result.error, /찾을 수 없습니다/);
  });

  it('refuses malformed requests with a 400 code, touching nothing', async () => {
    const { run, row, proposeTask } = setup();
    const p = await proposeTask('그대로');
    const bad = [
      () => apply(APP_SESSION, {}, run),
      () => apply(APP_SESSION, { proposal_id: p.proposal_id, selected: [] }, run),
      () => apply(APP_SESSION, { proposal_id: p.proposal_id, selected: [-1] }, run),
      () => apply(APP_SESSION, { proposal_ids: [] }, run),
      () => reject(APP_SESSION, { proposal_id: '  ' }, run),
      () => reject(APP_SESSION, { proposal_ids: Array.from({ length: PROPOSAL_BATCH_MAX + 1 }, (_, i) => 'AGP-X' + i) }, run)
    ];
    for (const call of bad) {
      await assert.rejects(call(), (e) => {
        assert.equal(e.code, PROPOSAL_BAD_REQUEST);
        assert.equal(errorDetails(e).status, 400);
        return true;
      });
    }
    assert.equal(row(p.proposal_id).status, 'pending');
  });
});

describe('proposals: batches', () => {
  it('applies each on its own, oldest first, with per-item results', async () => {
    const { run, tasks, proposeTask } = setup();
    const a = await proposeTask('첫째');
    const b = await proposeTask('둘째');
    const done = await proposeTask('이미 거절');
    await reject(APP_SESSION, { proposal_id: done.proposal_id }, run);
    const { results } = await apply(APP_SESSION, { proposal_ids: ['AGP-NOPE', b.proposal_id, done.proposal_id, a.proposal_id, a.proposal_id] }, run);
    assert.deepEqual(results, [
      { proposal_id: a.proposal_id, status: 'applied', verification_status: 'verified', error: '' },
      { proposal_id: b.proposal_id, status: 'applied', verification_status: 'verified', error: '' },
      { proposal_id: done.proposal_id, status: 'rejected', verification_status: '', error: ALREADY },
      { proposal_id: 'AGP-NOPE', status: '', verification_status: '', error: '제안을 찾을 수 없습니다.' }
    ]);
    assert.equal(tasks('첫째'), 1);
    assert.equal(tasks('둘째'), 1);
    // Again: already applied ones come back unchanged.
    const again = await apply(APP_SESSION, { proposal_ids: [a.proposal_id] }, run);
    assert.deepEqual(again.results, [results[0]]);
    assert.equal(tasks('첫째'), 1);
  });

  it('rejects in request order; settled and missing ones get an item error', async () => {
    const { run, row, proposeTask } = setup();
    const a = await proposeTask('거절 1');
    const b = await proposeTask('반영');
    await apply(APP_SESSION, { proposal_id: b.proposal_id }, run);
    const { results } = await reject(APP_SESSION, { proposal_ids: [b.proposal_id, a.proposal_id, 'AGP-NOPE'] }, run);
    assert.deepEqual(results, [
      { proposal_id: b.proposal_id, status: 'applied', verification_status: 'verified', error: ALREADY },
      { proposal_id: a.proposal_id, status: 'rejected', verification_status: '', error: '' },
      { proposal_id: 'AGP-NOPE', status: '', verification_status: '', error: '제안을 찾을 수 없습니다.' }
    ]);
    assert.equal(row(b.proposal_id).status, 'applied');
    const again = await reject(APP_SESSION, { proposal_ids: [a.proposal_id] }, run);
    assert.deepEqual(again.results, [results[1]]);
  });
});

describe('proposals: approval only in the app', () => {
  it('the connector can propose but cannot apply or reject, single or batch', async () => {
    const { run, tasks, row, proposeTask } = setup();
    const own = await proposeTask('커넥터 일', MCP_CONNECTOR);
    const web = await proposeTask('비서 일');
    const ids = [own.proposal_id, web.proposal_id];
    const attempts = [
      () => apply(MCP_CONNECTOR, { proposal_id: own.proposal_id }, run),
      () => apply(MCP_CONNECTOR, { proposal_ids: ids }, run),
      () => reject(MCP_CONNECTOR, { proposal_id: own.proposal_id }, run),
      () => reject(MCP_CONNECTOR, { proposal_ids: ids }, run)
    ];
    for (const attempt of attempts) {
      await assert.rejects(attempt(), (e) => {
        assert.equal(e.code, PROPOSAL_APP_ONLY);
        assert.equal(e.message, '승인과 거절은 앱 화면에서만 할 수 있습니다.');
        assert.equal(errorDetails(e).status, 403);
        return true;
      });
    }
    ids.forEach((id) => assert.equal(row(id).status, 'pending'));
    assert.equal(tasks('커넥터 일'), 0);
  });

  it('refuses callers that are not one of the two, even look-alikes', async () => {
    const { run, row, proposeTask } = setup();
    const p = await proposeTask('그대로');
    for (const caller of [undefined, null, 'app', { kind: 'app', source: 'assistant' }]) {
      await assert.rejects(apply(caller, { proposal_id: p.proposal_id }, run), /호출자|앱 화면에서만/);
      await assert.rejects(reject(caller, { proposal_id: p.proposal_id }, run), /호출자|앱 화면에서만/);
      await assert.rejects(propose(caller, { message: 'x', calls: [] }, run), /호출자/);
    }
    assert.equal(row(p.proposal_id).status, 'pending');
  });

  it('the generic browser API cannot change proposal state', () => {
    const api = LMS.createService(createMemoryStore());
    ['applyAgentProposal', 'rejectAgentProposals', 'rejectAgentProposal', 'markAgentProposalFailed', 'saveAgentTurn']
      .forEach((n) => assert.equal(isPublicApi(api, n), false, n));
    assert.equal(isPublicApi(api, 'listPendingProposals'), true);
  });

  it('a stored claude_approve mode reads as proposal', () => {
    assert.deepEqual(LMS.MCP_WRITE_MODES, ['read_only', 'proposal']);
    assert.equal(LMS.normalizeMcpWriteMode('claude_approve'), 'proposal');
    assert.equal(LMS.normalizeMcpWriteMode('direct'), 'proposal');
    assert.equal(LMS.normalizeMcpWriteMode('proposal'), 'proposal');
    assert.equal(LMS.normalizeMcpWriteMode(''), 'read_only');
  });
});
