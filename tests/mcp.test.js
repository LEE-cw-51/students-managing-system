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
const { AGENT_TOOLS } = require('../lib/agent-tools.js');
const { listTools, handleToolCall, handleMcpRequest, normalizeWriteMode, readWriteMode } = require('../lib/mcp-server.js');
const { withService } = require('../lib/store.js');
const { exchangeToken, issueAuthorizationCode, pkceChallenge, registerClient, validateAuthorizeParams } = require('../lib/oauth.js');
const { sign } = require('../lib/signing.js');

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const READ_NAMES = AGENT_TOOLS.filter((t) => t.kind === 'read').map((t) => t.name);
const WRITE_NAMES = AGENT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.name);

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
    assert.equal(normalizeWriteMode('direct'), 'direct');
    assert.equal(normalizeWriteMode(' proposal '), 'proposal');
    ['', null, undefined, 'DIRECT', 'write'].forEach((v) => assert.equal(normalizeWriteMode(v), 'read_only'));
    const { api, run } = setup();
    assert.equal(await readWriteMode(run), 'read_only');
    api.saveSettings({ mcp_write_mode: 'proposal' });
    assert.equal(await readWriteMode(run), 'proposal');
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

  it('proposal lists write tools as destructive and says approval is needed', () => {
    const tools = listTools('proposal');
    assert.deepEqual(tools.map((t) => t.name), [...READ_NAMES, ...WRITE_NAMES]);
    tools.filter((t) => WRITE_NAMES.includes(t.name)).forEach((t) => {
      assert.equal(t.annotations.readOnlyHint, false, t.name);
      assert.equal(t.annotations.destructiveHint, true, t.name);
      assert.match(t.description, /^\[승인 필요\] /, t.name);
      assert.match(t.description, /AI 비서에서 승인/, t.name);
      assert.equal(t.description.match(/\[승인 필요\]/g).length, 1, t.name);
    });
  });

  it('direct lists write tools without the approval wording', () => {
    const tools = listTools('direct');
    assert.deepEqual(tools.map((t) => t.name), [...READ_NAMES, ...WRITE_NAMES]);
    tools.filter((t) => WRITE_NAMES.includes(t.name)).forEach((t) => {
      assert.equal(t.annotations.destructiveHint, true, t.name);
      assert.doesNotMatch(t.description, /승인/, t.name);
    });
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
    const unknown = await handleToolCall('drop_tables', {}, { run, mode: 'direct' });
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

  it('direct mode applies the change and records it as applied', async () => {
    const { store, hong, lessonOf, run } = setup();
    const res = await handleToolCall('update_attendance', { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' }, { run, mode: 'direct' });
    assert.equal(res.isError, undefined);
    const out = parse(res);
    assert.equal(out.status, '저장했습니다.');
    assert.deepEqual(out.after, ['결석']);
    assert.equal(lessonOf(hong.student_id).attendance, '결석');
    const proposals = store.readTable('AgentProposals');
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].status, 'applied');
    assert.equal(proposals[0].verification_status, 'verified');
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
    const direct = await (await handleMcpRequest(rpc(LIST, headers), { run, getMode: async () => 'direct' })).json();
    assert.deepEqual(direct.result.tools.map((t) => t.name), [...READ_NAMES, ...WRITE_NAMES]);
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
