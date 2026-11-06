'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The /api/mcp route reads Settings through withService: keep its file store in a temp folder,
// never in dev-server/data.json. Must run before lib/store.js is loaded.
const originalCwd = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-mcp-'));
process.chdir(dataDir);
process.env.LMS_STORE = 'file';
process.env.AUTH_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');
const { AGENT_TOOLS, assistantTools, getAgentTool, mcpTools, toolDefinitions } = require('../lib/agent-tools.js');
const { MCP_READ_TOOLS, MCP_WRITE_TOOLS, MCP_APPROVAL_TOOLS } = require('../lib/mcp-tools/index.js');
const { anthropicToolDefinitions } = require('../lib/agent-anthropic.js');
const { listTools, handleToolCall, handleMcpRequest, normalizeWriteMode, readWriteMode, mcpRateLimit, MCP_RATE_LIMIT_DEFAULT, MCP_WRITE_MODES } = require('../lib/mcp-server.js');
const { applyProposal, applyProposals, rejectProposals } = require('../lib/agent.js');
const { withService } = require('../lib/store.js');
const { exchangeToken, issueAuthorizationCode, pkceChallenge, registerClient, validateAuthorizeParams } = require('../lib/oauth.js');
const { sign } = require('../lib/signing.js');

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const READ_NAMES = AGENT_TOOLS.filter((t) => t.kind === 'read').map((t) => t.name);
const WRITE_NAMES = AGENT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.name);
const APPROVAL_NAMES = ['list_pending_proposals', 'approve_proposals', 'reject_proposals'];

function setup() {
  const store = createMemoryStore();
  const api = LMS.createService(store);
  const demo = seedDemo(api);
  const [hong] = demo.students;
  // Like withService: every step reads the store again, so reads must not use api's cache.
  const lessonOf = (sid) => LMS.createService(store).getStudentLessons(sid, '2026-09-14', '2026-09-14')[0];
  const run = async (fn) => fn(LMS.createService(store));
  return { store, api, hong, lessonOf, run };
}

const parse = (result) => JSON.parse(result.content[0].text);

function rpc(body, headers = {}) {
  return new Request('https://lms.test/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body)
  });
}

const INIT = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
};
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };

describe('mcp write modes', () => {
  it('normalises unknown values to read_only and reads the mode from Settings', async () => {
    assert.deepEqual(MCP_WRITE_MODES, ['read_only', 'proposal', 'claude_approve']);
    assert.equal(normalizeWriteMode(' proposal '), 'proposal');
    assert.equal(normalizeWriteMode('claude_approve'), 'claude_approve');
    ['', null, undefined, 'DIRECT', 'write'].forEach((v) => assert.equal(normalizeWriteMode(v), 'read_only'));
    const { api, run } = setup();
    assert.equal(await readWriteMode(run), 'read_only');
    api.saveSettings({ mcp_write_mode: 'proposal' });
    assert.equal(await readWriteMode(run), 'proposal');
    api.saveSettings({ mcp_write_mode: 'claude_approve' });
    assert.equal(await readWriteMode(run), 'claude_approve');
  });

  it('maps the removed direct mode to proposal, keeping write tools but queued', async () => {
    assert.equal(normalizeWriteMode('direct'), 'proposal');
    assert.equal(normalizeWriteMode(' direct '), 'proposal');
    assert.deepEqual(listTools('direct'), listTools('proposal'));
    const { store, api, run } = setup();
    store.writeTable('Settings', LMS.settingsToRows({ ...api.getSettings(), mcp_write_mode: 'direct' }));
    assert.equal(await readWriteMode(run), 'proposal');
    assert.equal(LMS.createService(store).saveSettings({ mcp_write_mode: 'direct' }).mcp_write_mode, 'proposal');
    assert.equal(LMS.createService(store).getSettings().mcp_write_mode, 'proposal');
  });

  it('saveSettings rejects unknown write modes; blank or an already-stored unknown value falls back to read_only', () => {
    const { store, api } = setup();
    api.saveSettings({ mcp_write_mode: 'proposal' });
    ['write', 'DIRECT', 'full'].forEach((v) => {
      assert.throws(() => LMS.createService(store).saveSettings({ mcp_write_mode: v, academy_name: '바뀜' }), /조회만\(read_only\), 승인 대기 제안\(proposal\), Claude에서 승인\(claude_approve\)/);
    });
    // Nothing was written by the rejected saves.
    assert.equal(LMS.createService(store).getSettings().mcp_write_mode, 'proposal');
    assert.notEqual(LMS.createService(store).getSettings().academy_name, '바뀜');
    assert.equal(LMS.createService(store).saveSettings({ mcp_write_mode: ' proposal ' }).mcp_write_mode, 'proposal');
    assert.equal(LMS.createService(store).saveSettings({ mcp_write_mode: '' }).mcp_write_mode, 'read_only');
    // A hand-edited value in the sheet must not block the settings page, which resends it.
    store.writeTable('Settings', LMS.settingsToRows({ ...api.getSettings(), mcp_write_mode: 'write' }));
    assert.equal(LMS.createService(store).saveSettings({ mcp_write_mode: 'write', academy_name: '새 이름' }).mcp_write_mode, 'read_only');
    assert.equal(LMS.createService(store).getSettings().academy_name, '새 이름');
    // Saves without the key leave the mode alone.
    assert.equal(LMS.createService(store).saveSettings({ contact: '010-0000-0000' }).mcp_write_mode, 'read_only');
  });

  it('bulk write tools cap their arrays with maxItems', () => {
    const schema = (name) => listTools('proposal').find((t) => t.name === name).inputSchema.properties;
    assert.equal(schema('save_lessons_batch').items.maxItems, LMS.AGENT_BATCH_MAX);
    assert.equal(schema('set_students_status').student_ids.maxItems, LMS.AGENT_BATCH_MAX);
    assert.equal(schema('move_students').student_ids.maxItems, LMS.AGENT_BATCH_MAX);
    assert.equal(schema('create_makeup').student_ids.maxItems, LMS.AGENT_BATCH_MAX);
    assert.equal(schema('save_session_homework').titles.maxItems, LMS.AGENT_BATCH_MAX);
    assert.equal(schema('save_student_homework_items').titles.maxItems, LMS.AGENT_BATCH_MAX);
    assert.equal(schema('save_homework_checks').checks.maxItems, LMS.AGENT_CHECKS_MAX);
    assert.equal(schema('set_exam_period_suspended_classes').class_ids.maxItems, LMS.AGENT_BATCH_MAX);
    assert.equal(schema('save_school_exams_batch').exams.maxItems, LMS.AGENT_BATCH_MAX);
  });

  it('read_only lists only the read tools, marked read-only', () => {
    const tools = listTools('read_only');
    assert.deepEqual(tools.map((t) => t.name), READ_NAMES);
    tools.forEach((t) => {
      assert.equal(t.annotations.readOnlyHint, true, t.name);
      assert.equal(t.annotations.destructiveHint, false, t.name);
      assert.equal(t.inputSchema.type, 'object', t.name);
    });
    assert.deepEqual(listTools('nonsense').map((t) => t.name), READ_NAMES);
  });

  it('proposal lists write tools, destructive unless marked otherwise, and says approval is needed', () => {
    const tools = listTools('proposal');
    assert.deepEqual(tools.map((t) => t.name), [...READ_NAMES, ...WRITE_NAMES]);
    tools.filter((t) => WRITE_NAMES.includes(t.name)).forEach((t) => {
      assert.equal(t.annotations.readOnlyHint, false, t.name);
      assert.equal(t.annotations.destructiveHint, getAgentTool(t.name).destructive !== false, t.name);
      if (/^(delete|cancel|close|archive|remove)_/.test(t.name)) assert.equal(t.annotations.destructiveHint, true, t.name);
      assert.match(t.description, /^\[승인 필요\] /, t.name);
      assert.match(t.description, /AI 비서에서 승인/, t.name);
      assert.equal(t.description.match(/\[승인 필요\]/g).length, 1, t.name);
    });
  });

  it('marks every write tool as needing approval, destructive or not', () => {
    const writes = listTools('proposal').filter((t) => WRITE_NAMES.includes(t.name));
    assert.ok(writes.some((t) => t.annotations.destructiveHint) && writes.some((t) => !t.annotations.destructiveHint));
    writes.forEach((t) => assert.match(t.description, /^\[승인 필요\] .*AI 비서에서 승인/, t.name));
  });
});

describe('mcp tool surfaces', () => {
  const MCP_ONLY_READS = MCP_READ_TOOLS.map((t) => t.name);
  const MCP_ONLY_WRITES = MCP_WRITE_TOOLS.map((t) => t.name);
  const MCP_ONLY = [...MCP_ONLY_READS, ...MCP_ONLY_WRITES, ...MCP_APPROVAL_TOOLS.map((t) => t.name)];

  it('read_only lists every read tool, including the MCP-only ones, and no write tool', () => {
    const names = listTools('read_only').map((t) => t.name);
    assert.equal(MCP_ONLY_READS.length, 24);
    MCP_ONLY_READS.forEach((n) => assert.ok(names.includes(n), n));
    assert.ok(names.every((n) => getAgentTool(n).kind === 'read'));
    assert.equal(names.length, READ_NAMES.length);
  });

  it('proposal lists every write tool, each backed by a write action', () => {
    assert.equal(MCP_ONLY_WRITES.length, 46);
    const names = listTools('proposal').map((t) => t.name);
    WRITE_NAMES.forEach((n) => assert.ok(names.includes(n), n));
    assert.deepEqual([...WRITE_NAMES].sort(), Object.keys(LMS.AGENT_WRITE_ACTIONS).sort());
  });

  it('never exposes a settings writer; get_settings hides tokens and allowed emails', async () => {
    const names = mcpTools().map((t) => t.name);
    assert.deepEqual(names.filter((n) => /setting/.test(n)), ['get_settings']);
    assert.ok(!Object.keys(LMS.AGENT_WRITE_ACTIONS).some((n) => /setting/i.test(n)));
    const { api, run } = setup();
    api.saveSettings({ mcp_token_version: '7', allowed_emails: 'a@b.c', academy_name: '테스트 학원' });
    const out = parse(await handleToolCall('get_settings', {}, { run, mode: 'proposal' }));
    assert.equal(out.academy_name, '테스트 학원');
    assert.equal('mcp_token_version' in out, false);
    assert.equal('allowed_emails' in out, false);
  });

  it('the in-app assistant gets only its own tools, never the MCP-only ones', () => {
    const openAi = toolDefinitions().map((d) => d.function.name);
    const anthropic = anthropicToolDefinitions().map((d) => d.name);
    const assistant = assistantTools().map((t) => t.name);
    assert.equal(assistant.length, 13);
    assert.deepEqual(openAi, assistant);
    assert.deepEqual(anthropic, assistant);
    MCP_ONLY.forEach((n) => {
      assert.ok(!openAi.includes(n), n);
      assert.ok(!anthropic.includes(n), n);
    });
  });

  it('handleToolCall rejects an unknown tool, and a write tool in read_only', async () => {
    const { store, run } = setup();
    const unknown = await handleToolCall('save_settings', {}, { run, mode: 'proposal' });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /없는 도구/);
    const hidden = await handleToolCall('create_task', { due_date: '2026-09-20', title: 'x' }, { run, mode: 'read_only' });
    assert.equal(hidden.isError, true);
    assert.match(hidden.content[0].text, /없는 도구/);
    assert.equal(store.readTable('AgentProposals').length, 0);
    assert.equal(store.readTable('Tasks').filter((t) => t.title === 'x').length, 0);
  });

  it('an MCP-only write tool is saved only once its proposal is approved', async () => {
    const { store, hong, run } = setup();
    const res = await handleToolCall('create_task', { due_date: '2026-09-20', kind: 'admin', title: '교재 주문', student_id: hong.student_id }, { run, mode: 'proposal' });
    assert.equal(res.isError, undefined, res.content[0].text);
    const out = parse(res);
    assert.match(out.status, /^승인 대기에 추가했습니다\. 아직 저장되지 않았고/);
    assert.equal(store.readTable('Tasks').filter((t) => t.title === '교재 주문').length, 0);
    assert.equal(store.readTable('AgentProposals')[0].status, 'pending');
    const applied = await applyProposal(out.proposal_id, run);
    assert.equal(applied.verification_status, 'verified');
    assert.equal(store.readTable('Tasks').filter((t) => t.title === '교재 주문').length, 1);
    assert.equal(store.readTable('AgentProposals')[0].status, 'applied');
  });
});

describe('mcp tool calls', () => {
  it('runs a read tool through run', async () => {
    const { hong, run } = setup();
    const res = await handleToolCall('search_students', { query: '길동' }, { run, mode: 'read_only' });
    assert.equal(res.isError, undefined);
    const out = parse(res);
    assert.equal(out.count, 1);
    assert.equal(out.students[0].student_id, hong.student_id);
  });

  it('returns errors as readable tool results', async () => {
    const { run } = setup();
    const unknown = await handleToolCall('drop_tables', {}, { run, mode: 'proposal' });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /없는 도구/);
    const bad = await handleToolCall('update_attendance', { lesson_id: 'LES-9999', attendance: '결석' }, { run, mode: 'proposal' });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /찾을 수 없습니다/);
  });

  it('read_only refuses write tools and changes nothing', async () => {
    const { store, hong, lessonOf, run } = setup();
    const res = await handleToolCall('update_attendance', { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' }, { run, mode: 'read_only' });
    assert.equal(res.isError, true);
    assert.equal(lessonOf(hong.student_id).attendance, '출석');
    assert.equal(store.readTable('AgentProposals').length, 0);
  });

  it('proposal mode adds a pending proposal without saving the change', async () => {
    const { store, hong, lessonOf, run } = setup();
    const res = await handleToolCall('update_attendance', { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' }, { run, mode: 'proposal' });
    assert.equal(res.isError, undefined);
    const out = parse(res);
    assert.match(out.status, /승인 대기/);
    assert.match(out.change, /홍길동 · 2026-09-14 중2 A반 출결: 출석 → 결석/);
    assert.equal(lessonOf(hong.student_id).attendance, '출석');
    const proposals = store.readTable('AgentProposals');
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].proposal_id, out.proposal_id);
    assert.equal(proposals[0].status, 'pending');
    const conv = LMS.createService(store).listAgentConversations()[0];
    assert.match(conv.title, /^\[Claude 커넥터\]/);
  });

  it('queues creates and destructive changes alike, writing nothing until approval', async () => {
    const { store, hong, lessonOf, run } = setup();
    assert.equal(getAgentTool('create_task').destructive, false);
    assert.notEqual(getAgentTool('update_attendance').destructive, false);
    // A stored legacy 'direct' behaves exactly like proposal.
    for (const mode of ['proposal', 'direct']) {
      const create = parse(await handleToolCall('create_task', { due_date: '2026-09-20', kind: 'admin', title: `교재 ${mode}` }, { run, mode }));
      const destroy = parse(await handleToolCall('update_attendance', { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' }, { run, mode }));
      [create, destroy].forEach((out) => {
        assert.match(out.status, /^승인 대기에 추가했습니다\. 아직 저장되지 않았고/);
        assert.equal('after' in out, false);
      });
      assert.equal(store.readTable('Tasks').filter((t) => t.title === `교재 ${mode}`).length, 0);
      assert.equal(lessonOf(hong.student_id).attendance, '출석');
    }
    const proposals = store.readTable('AgentProposals');
    assert.equal(proposals.length, 4);
    assert.ok(proposals.every((p) => p.status === 'pending'));
    const attendance = proposals.find((p) => /update_attendance/.test(JSON.stringify(p.calls)));
    await applyProposal(attendance.proposal_id, run);
    assert.equal(lessonOf(hong.student_id).attendance, '결석');
  });
});

describe('mcp approval tools (claude_approve)', () => {
  const queueTask = async (run, title, mode = 'claude_approve') => parse(await handleToolCall(
    'create_task', { due_date: '2026-09-20', kind: 'admin', title }, { run, mode }
  ));
  const tasksTitled = (store, title) => store.readTable('Tasks').filter((t) => t.title === title).length;

  it('lists the three approval tools only in claude_approve, with approve and reject destructive', () => {
    assert.deepEqual(MCP_APPROVAL_TOOLS.map((t) => t.name), APPROVAL_NAMES);
    APPROVAL_NAMES.forEach((n) => assert.equal(getAgentTool(n).kind, 'approval', n));
    ['read_only', 'proposal', 'direct', 'nonsense'].forEach((mode) => {
      const names = listTools(mode).map((t) => t.name);
      APPROVAL_NAMES.forEach((n) => assert.ok(!names.includes(n), `${mode} ${n}`));
    });
    const tools = listTools('claude_approve');
    assert.deepEqual(tools.map((t) => t.name), [...READ_NAMES, ...WRITE_NAMES, ...APPROVAL_NAMES]);
    const byName = (n) => tools.find((t) => t.name === n);
    assert.equal(byName('list_pending_proposals').annotations.readOnlyHint, true);
    assert.equal(byName('list_pending_proposals').annotations.destructiveHint, false);
    ['approve_proposals', 'reject_proposals'].forEach((n) => {
      assert.equal(byName(n).annotations.readOnlyHint, false, n);
      assert.equal(byName(n).annotations.destructiveHint, true, n);
      assert.match(byName(n).description, /직접 말했을 때만/, n);
    });
    tools.filter((t) => WRITE_NAMES.includes(t.name)).forEach((t) => assert.match(t.description, /^\[승인 필요\] .*Claude에게 승인하라고/, t.name));
  });

  it('read_only and proposal refuse the approval tools and change nothing', async () => {
    const { store, run } = setup();
    const { proposal_id } = await queueTask(run, '교재 주문', 'proposal');
    for (const mode of ['read_only', 'proposal']) {
      for (const name of APPROVAL_NAMES) {
        const res = await handleToolCall(name, { proposal_ids: [proposal_id] }, { run, mode });
        assert.equal(res.isError, true, `${mode} ${name}`);
        assert.match(res.content[0].text, /없는 도구/);
      }
    }
    assert.equal(store.readTable('AgentProposals')[0].status, 'pending');
    assert.equal(tasksTitled(store, '교재 주문'), 0);
  });

  it('lists a queued proposal, then approving it saves the change', async () => {
    const { store, run } = setup();
    const queued = await queueTask(run, '교재 주문');
    assert.match(queued.status, /승인하라고 말씀하시면 반영됩니다/);
    const list = parse(await handleToolCall('list_pending_proposals', {}, { run, mode: 'claude_approve' }));
    assert.equal(list.count, 1);
    assert.equal(list.proposals[0].proposal_id, queued.proposal_id);
    assert.ok(list.proposals[0].created_at);
    assert.equal(list.proposals[0].change, queued.change);
    assert.equal(tasksTitled(store, '교재 주문'), 0);

    const res = await handleToolCall('approve_proposals', { proposal_ids: [queued.proposal_id] }, { run, mode: 'claude_approve' });
    assert.equal(res.isError, undefined, res.content[0].text);
    const [item] = parse(res).results;
    assert.equal(item.proposal_id, queued.proposal_id);
    assert.equal(item.status, 'applied');
    assert.equal(item.verification_status, 'verified');
    assert.equal(item.error, '');
    assert.equal(tasksTitled(store, '교재 주문'), 1);
    assert.equal(store.readTable('AgentProposals')[0].status, 'applied');
    assert.equal(parse(await handleToolCall('list_pending_proposals', {}, { run, mode: 'claude_approve' })).count, 0);
  });

  it('rejects a proposal, and reports unknown ids per item', async () => {
    const { store, run } = setup();
    const queued = await queueTask(run, '거절할 일');
    const res = parse(await handleToolCall('reject_proposals', { proposal_ids: [queued.proposal_id, 'AGP-9999'] }, { run, mode: 'claude_approve' }));
    assert.equal(res.results.find((r) => r.proposal_id === queued.proposal_id).status, 'rejected');
    assert.ok(res.results.find((r) => r.proposal_id === 'AGP-9999').error);
    assert.equal(store.readTable('AgentProposals')[0].status, 'rejected');
    assert.equal(tasksTitled(store, '거절할 일'), 0);

    const missing = parse(await handleToolCall('approve_proposals', { proposal_ids: ['AGP-9999'] }, { run, mode: 'claude_approve' }));
    assert.deepEqual(missing.results, [{ proposal_id: 'AGP-9999', status: '', verification_status: '', error: '제안을 찾을 수 없습니다.' }]);
    const empty = await handleToolCall('approve_proposals', { proposal_ids: [] }, { run, mode: 'claude_approve' });
    assert.equal(empty.isError, true);
  });

  // A proposal from the in-app assistant chat (no source passed).
  const assistantTask = (store, title) => LMS.createService(store).saveAgentTurn({
    message: `${title} 할 일 만들어 줘`, reply: '확인해 주세요.',
    calls: [{ tool: 'create_task', args: { due_date: '2026-09-20', kind: 'admin', title } }]
  }).message.proposal.proposal_id;
  const statusOf = (store, id) => store.readTable('AgentProposals').find((p) => p.proposal_id === id).status;
  const call = async (run, name, ids) => parse(await handleToolCall(name, ids ? { proposal_ids: ids } : {}, { run, mode: 'claude_approve' }));

  it('records where a proposal came from', async () => {
    const { store, run } = setup();
    const mcpId = (await queueTask(run, '커넥터 일')).proposal_id;
    const webId = assistantTask(store, '비서 일');
    const rows = store.readTable('AgentProposals');
    assert.equal(rows.find((p) => p.proposal_id === mcpId).source, 'mcp');
    assert.equal(rows.find((p) => p.proposal_id === webId).source, 'assistant');
  });

  it('lists only connector proposals; assistant ones get an item error and stay pending', async () => {
    const { store, run } = setup();
    const mcpId = (await queueTask(run, '커넥터 일')).proposal_id;
    const webId = assistantTask(store, '비서 일');

    const list = await call(run, 'list_pending_proposals');
    assert.deepEqual(list.proposals.map((p) => p.proposal_id), [mcpId]);

    const approved = await call(run, 'approve_proposals', [webId, mcpId]);
    assert.deepEqual(approved.results.find((r) => r.proposal_id === webId),
      { proposal_id: webId, status: '', verification_status: '', error: LMS.AGENT_SOURCE_MISMATCH });
    assert.equal(approved.results.find((r) => r.proposal_id === mcpId).status, 'applied');
    assert.equal(statusOf(store, webId), 'pending');
    assert.equal(tasksTitled(store, '비서 일'), 0);

    const rejected = await call(run, 'reject_proposals', [webId]);
    assert.deepEqual(rejected.results, [{ proposal_id: webId, status: '', verification_status: '', error: LMS.AGENT_SOURCE_MISMATCH }]);
    assert.equal(statusOf(store, webId), 'pending');
  });

  it('treats rows without source as connector-made only when the title has the connector prefix', async () => {
    const { store, run } = setup();
    const mcpId = (await queueTask(run, '예전 커넥터 일')).proposal_id;
    const webId = assistantTask(store, '예전 비서 일');
    store.writeTable('AgentProposals', store.readTable('AgentProposals').map((p) => {
      const { source, ...rest } = p;
      return rest;
    }));
    assert.deepEqual((await call(run, 'list_pending_proposals')).proposals.map((p) => p.proposal_id), [mcpId]);
    assert.equal((await call(run, 'reject_proposals', [webId])).results[0].error, LMS.AGENT_SOURCE_MISMATCH);
    assert.equal((await call(run, 'reject_proposals', [mcpId])).results[0].status, 'rejected');
    assert.equal(statusOf(store, webId), 'pending');
  });

  it('web approval paths still handle proposals from both sources', async () => {
    const { store, run } = setup();
    const mcpId = (await queueTask(run, '커넥터 일')).proposal_id;
    const webId = assistantTask(store, '비서 일');
    const webId2 = assistantTask(store, '비서 거절');
    assert.deepEqual(LMS.createService(store).listPendingProposals().map((p) => p.proposal_id), [mcpId, webId, webId2]);
    const applied = await applyProposals([mcpId, webId], run);
    assert.deepEqual(applied.results.map((r) => [r.proposal_id, r.status, r.error]), [[mcpId, 'applied', ''], [webId, 'applied', '']]);
    const rejected = await rejectProposals([webId2], run);
    assert.equal(rejected.results[0].status, 'rejected');
  });
});

describe('mcp rate limit', () => {
  it('reads MCP_RATE_LIMIT_PER_HOUR with a default of 300', () => {
    assert.equal(MCP_RATE_LIMIT_DEFAULT, 300);
    assert.equal(mcpRateLimit(undefined), 300);
    assert.equal(mcpRateLimit(' '), 300);
    assert.equal(mcpRateLimit('20'), 20);
    assert.equal(mcpRateLimit('0'), 0);
    assert.equal(mcpRateLimit('-1'), 300);
    assert.equal(mcpRateLimit('abc'), 300);
  });

  it('counts every tool call per hour, apart from the assistant chat turns', async () => {
    const { store, hong, run } = setup();
    const T0 = Date.UTC(2026, 8, 14, 9);
    const opts = (now, mode = 'proposal') => ({ run, mode, rateLimit: 2, now });
    // Chat turns live in the same table but do not use up connector calls.
    LMS.createService(store).reserveAgentTurn(T0, 60);
    assert.equal((await handleToolCall('search_students', { query: '길동' }, opts(T0))).isError, undefined);
    const write = await handleToolCall('create_task', { due_date: '2026-09-20', kind: 'admin', title: '교재 주문' }, opts(T0 + 1000));
    assert.equal(write.isError, undefined, write.content[0].text);
    const limited = await handleToolCall('search_students', { query: '길동' }, opts(T0 + 2000));
    assert.equal(limited.isError, true);
    assert.match(limited.content[0].text, /한 시간에 도구를 2번까지 쓸 수 있습니다. 약 60분 뒤에/);
    const blockedWrite = await handleToolCall('create_task', { due_date: '2026-09-21', kind: 'admin', title: '두 번째' }, opts(T0 + 3000));
    assert.equal(blockedWrite.isError, true);
    assert.equal(store.readTable('AgentProposals').length, 1);
    // Unknown tools are refused before counting.
    assert.match((await handleToolCall('drop_tables', {}, opts(T0 + 4000))).content[0].text, /없는 도구/);
    const usage = store.readTable('AgentUsage');
    assert.equal(usage.filter((u) => u.kind === 'mcp').length, 2);
    assert.equal(usage.filter((u) => !u.kind).length, 1);
    // The window slides: an hour later the first call has expired.
    const later = await handleToolCall('get_student_profile', { student_id: hong.student_id }, opts(T0 + 60 * 60000 + 1));
    assert.equal(later.isError, undefined, later.content[0].text);
    // 0 turns the limit off.
    assert.equal((await handleToolCall('search_students', { query: '길동' }, { run, mode: 'proposal', rateLimit: 0, now: T0 + 5000 })).isError, undefined);
  });
});

describe('mcp over HTTP', () => {
  it('answers initialize and tools/list for the current mode', async () => {
    const { run } = setup();
    const init = await handleMcpRequest(rpc(INIT), { run, getMode: async () => 'read_only' });
    assert.equal(init.status, 200);
    const initBody = await init.json();
    assert.equal(initBody.id, 1);
    assert.equal(initBody.result.serverInfo.name, 'students-managing-system');
    assert.ok(initBody.result.capabilities.tools);

    const headers = { 'MCP-Protocol-Version': initBody.result.protocolVersion };
    const readOnly = await (await handleMcpRequest(rpc(LIST, headers), { run, getMode: async () => 'read_only' })).json();
    assert.deepEqual(readOnly.result.tools.map((t) => t.name), READ_NAMES);
    const proposal = await (await handleMcpRequest(rpc(LIST, headers), { run, getMode: async () => 'proposal' })).json();
    assert.deepEqual(proposal.result.tools.map((t) => t.name), [...READ_NAMES, ...WRITE_NAMES]);
  });

  it('runs tools/call', async () => {
    const { hong, run } = setup();
    const call = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_students', arguments: { query: '길동' } } };
    const body = await (await handleMcpRequest(rpc(call), { run, getMode: async () => 'read_only' })).json();
    assert.equal(JSON.parse(body.result.content[0].text).students[0].student_id, hong.student_id);
  });
});

describe('/api/mcp route', () => {
  const routeP = import('../app/api/mcp/route.js');

  async function accessToken() {
    const ru = 'https://claude.ai/api/mcp/auth_callback';
    const { client } = registerClient({ redirect_uris: [ru] });
    const verifier = 'v'.repeat(43);
    const params = validateAuthorizeParams({
      client_id: client.client_id, redirect_uri: ru, response_type: 'code',
      code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256'
    });
    const code = await issueAuthorizationCode(params);
    const { tokens } = await exchangeToken({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, redirect_uri: ru });
    return tokens.access_token;
  }

  function assertUnauthorized(res) {
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('WWW-Authenticate'), 'Bearer resource_metadata="https://lms.test/.well-known/oauth-protected-resource"');
  }

  it('answers 401 with WWW-Authenticate for a missing, forged or expired token', async () => {
    const { POST, GET, DELETE } = await routeP;
    assertUnauthorized(await POST(rpc(LIST)));
    assertUnauthorized(await POST(rpc(LIST, { Authorization: 'Bearer nope' })));
    const forged = sign({ typ: 'access', ver: '0', exp: Math.floor(Date.now() / 1000) + 60 }).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assertUnauthorized(await POST(rpc(LIST, { Authorization: `Bearer ${forged}` })));
    const expired = sign({ typ: 'access', cid: 'c', ver: '0', exp: Math.floor(Date.now() / 1000) - 1 });
    assertUnauthorized(await POST(rpc(LIST, { Authorization: `Bearer ${expired}` })));
    assertUnauthorized(await GET(new Request('https://lms.test/api/mcp')));
    assertUnauthorized(await DELETE(new Request('https://lms.test/api/mcp', { method: 'DELETE' })));
  });

  it('serves a valid token with the Settings mode, until the connection is cut', async () => {
    const { POST, GET } = await routeP;
    const token = await accessToken();
    const auth = { Authorization: `Bearer ${token}` };
    const first = await POST(rpc(LIST, auth));
    assert.equal(first.status, 200);
    assert.deepEqual((await first.json()).result.tools.map((t) => t.name), READ_NAMES);

    await withService((api) => api.saveSettings({ mcp_write_mode: 'proposal' }));
    const second = await (await POST(rpc(LIST, auth))).json();
    assert.deepEqual(second.result.tools.map((t) => t.name), [...READ_NAMES, ...WRITE_NAMES]);
    assert.equal((await GET(new Request('https://lms.test/api/mcp', { headers: auth }))).status, 405);

    await withService((api) => api.saveSettings({ mcp_token_version: '1' }));
    assertUnauthorized(await POST(rpc(LIST, auth)));
  });
});
