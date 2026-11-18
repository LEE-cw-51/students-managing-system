'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');
const {
  APP_SESSION,
  MCP_CONNECTOR,
  PROPOSE_MAX_CHANGES,
  PROPOSAL_APP_ONLY,
  apply,
  proposeAssistantTurn,
  proposeConnectorWrite,
  reject,
  stageWrite,
  writePolicy
} = require('../lib/ai-propose.js');
const { errorDetails } = require('../lib/api-error.js');

function setup() {
  const store = createMemoryStore();
  const demo = seedDemo(LMS.createService(store));
  const run = async (fn) => fn(LMS.createService(store));
  const task = (title) => ({ tool: 'create_task', args: { due_date: '2026-09-20', kind: 'admin', title } });
  const tasks = (title) => store.readTable('Tasks').filter((t) => t.title === title).length;
  const row = (id) => store.readTable('AgentProposals').find((p) => p.proposal_id === id);
  return { store, run, demo, task, tasks, row };
}

describe('ai-propose: stageWrite', () => {
  it('previews a write into the bucket with the policy queued status', async () => {
    const { run } = setup();
    const policy = writePolicy('assistant');
    const bucket = { pending: [], seen: new Set() };
    const result = await stageWrite(run, 'create_task', {
      due_date: '2026-09-20', kind: 'admin', title: '교재'
    }, bucket, { queued: policy.queued });
    assert.equal(result.status, policy.queued);
    assert.ok(result.change);
    assert.equal(bucket.pending.length, 1);
    assert.equal(bucket.pending[0].tool, 'create_task');
    assert.equal(bucket.pending[0].args.title, '교재');
    assert.ok(bucket.pending[0].preview);
  });

  it('dedupes the same write and caps the bucket', async () => {
    const { run } = setup();
    const queued = writePolicy('assistant').queued;
    const args = { due_date: '2026-09-20', kind: 'admin', title: '같은 일' };
    const bucket = { pending: [], seen: new Set() };
    const first = await stageWrite(run, 'create_task', args, bucket, { queued });
    const again = await stageWrite(run, 'create_task', args, bucket, { queued });
    assert.equal(first.status, queued);
    assert.equal(again.status, '이미 승인 대기에 있습니다.');
    assert.equal(bucket.pending.length, 1);

    const full = { pending: [], seen: new Set() };
    for (let i = 0; i < 2; i++) {
      await stageWrite(run, 'create_task', {
        due_date: '2026-09-20', kind: 'admin', title: `한도-${i}`
      }, full, { maxChanges: 2, queued });
    }
    const over = await stageWrite(run, 'create_task', {
      due_date: '2026-09-20', kind: 'admin', title: '한도-넘침'
    }, full, { maxChanges: 2, queued });
    assert.equal(full.pending.length, 2);
    assert.match(over.error, /2건까지/);
    assert.equal(PROPOSE_MAX_CHANGES, 30);
  });

  it('refuses an invalid write without touching the bucket', async () => {
    const { run } = setup();
    const bucket = { pending: [], seen: new Set() };
    await assert.rejects(
      stageWrite(run, 'update_attendance', { lesson_id: 'LES-9999', attendance: '결석' }, bucket, {
        queued: writePolicy('assistant').queued
      }),
      /찾을 수 없습니다/
    );
    assert.equal(bucket.pending.length, 0);
  });
});

describe('ai-propose: propose turns', () => {
  it('proposeAssistantTurn saves staged calls as one pending proposal', async () => {
    const { run, tasks, row } = setup();
    const policy = writePolicy('assistant');
    const bucket = { pending: [], seen: new Set() };
    await stageWrite(run, 'create_task', {
      due_date: '2026-09-20', kind: 'admin', title: '비서 제안'
    }, bucket, { queued: policy.queued });
    const saved = await proposeAssistantTurn({
      message: '할 일 추가',
      reply: '승인해 주세요.',
      calls: bucket.pending
    }, run);
    const p = saved.message.proposal;
    assert.equal(p.status, 'pending');
    assert.equal(row(p.proposal_id).source, 'assistant');
    assert.equal(tasks('비서 제안'), 0);
  });

  it('proposeConnectorWrite queues via MCP_CONNECTOR and returns queued status', async () => {
    const { run, tasks, row } = setup();
    const policy = writePolicy('mcp', 'proposal');
    const out = await proposeConnectorWrite(
      { name: 'create_task' },
      { due_date: '2026-09-20', kind: 'admin', title: '커넥터 제안' },
      run,
      policy
    );
    assert.equal(out.status, policy.queued);
    assert.ok(out.proposal_id);
    assert.ok(out.change);
    assert.equal(row(out.proposal_id).source, 'mcp');
    assert.equal(row(out.proposal_id).status, 'pending');
    assert.equal(tasks('커넥터 제안'), 0);
  });

  it('previews once per logical write (assistant stage→propose and connector)', async () => {
    const store = createMemoryStore();
    seedDemo(LMS.createService(store));
    let previewCount = 0;
    const run = async (fn) => {
      const api = LMS.createService(store);
      const preview = api.previewAgentAction.bind(api);
      api.previewAgentAction = (tool, args) => {
        previewCount += 1;
        return preview(tool, args);
      };
      return fn(api);
    };

    previewCount = 0;
    const bucket = { pending: [], seen: new Set() };
    await stageWrite(run, 'create_task', {
      due_date: '2026-09-20', kind: 'admin', title: '한 번만'
    }, bucket, { queued: writePolicy('assistant').queued });
    await proposeAssistantTurn({
      message: '할 일',
      reply: '승인해 주세요.',
      calls: bucket.pending
    }, run);
    assert.equal(previewCount, 1, 'assistant: stage previews; propose/save reuse it');

    previewCount = 0;
    await proposeConnectorWrite(
      { name: 'create_task' },
      { due_date: '2026-09-20', kind: 'admin', title: '커넥터 한 번' },
      run,
      writePolicy('mcp', 'proposal')
    );
    assert.equal(previewCount, 1, 'connector: proposeConnectorWrite previews; propose/save reuse it');
  });
});

describe('ai-propose: apply/reject stay APP_SESSION only (ADR-0002)', () => {
  it('connector can propose but cannot apply or reject through the facade', async () => {
    const { run, tasks, row } = setup();
    const policy = writePolicy('mcp', 'proposal');
    const out = await proposeConnectorWrite(
      { name: 'create_task' },
      { due_date: '2026-09-20', kind: 'admin', title: '승인 불가' },
      run,
      policy
    );
    const attempts = [
      () => apply(MCP_CONNECTOR, { proposal_id: out.proposal_id }, run),
      () => reject(MCP_CONNECTOR, { proposal_id: out.proposal_id }, run)
    ];
    for (const attempt of attempts) {
      await assert.rejects(attempt(), (e) => {
        assert.equal(e.code, PROPOSAL_APP_ONLY);
        assert.equal(errorDetails(e).status, 403);
        return true;
      });
    }
    assert.equal(row(out.proposal_id).status, 'pending');
    assert.equal(tasks('승인 불가'), 0);

    const applied = await apply(APP_SESSION, { proposal_id: out.proposal_id }, run);
    assert.equal(applied.status, 'applied');
    assert.equal(tasks('승인 불가'), 1);
  });
});
