'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');
const { AGENT_TOOLS, assistantTools, mcpTools, toolDefinitions, toolResultText, TOOL_RESULT_MAX_CHARS } = require('../lib/agent-tools.js');
const {
  runAgentTurn, agentRateLimit, AGENT_RATE_LIMITED
} = require('../lib/agent.js');
const { APP_SESSION, apply, reject, PROPOSAL_BATCH_MAX } = require('../lib/proposals.js');

const applyProposal = (id, run, selected) => apply(APP_SESSION, { proposal_id: id, selected }, run);
const applyProposals = (ids, run) => apply(APP_SESSION, { proposal_ids: ids }, run);
const rejectProposals = (ids, run) => reject(APP_SESSION, { proposal_ids: ids }, run);
const { abortedError, chatWithTools, parseToolArguments } = require('../lib/ai-client.js');

const CONFIG = { key: 'test-key', baseUrl: 'https://ai.test/v1', model: 'test-model' };

function setup() {
  const store = createMemoryStore();
  const api = LMS.createService(store);
  const demo = seedDemo(api);
  const [hong, kim] = demo.students;
  const lessonOf = (sid) => api.getStudentLessons(sid, '2026-09-14', '2026-09-14')[0];
  // Same shape as withService: each step runs in one transaction on the shared store.
  const run = async (fn) => fn(api);
  return { store, api, demo, hong, kim, lessonOf, run };
}

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** Fake chat endpoint: each request gets the next scripted assistant message. */
function scriptedFetch(script) {
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const next = script[requests.length - 1];
    if (!next) throw new Error('unexpected extra AI call');
    if (next.status) return { ok: false, status: next.status, json: async () => ({ error: { message: 'boom' } }) };
    return { ok: true, status: 200, json: async () => ({ model: 'test-model', choices: [{ message: next }] }) };
  };
  return { fetch, requests };
}

/**
 * Fake streaming chat endpoint: each request gets the next scripted list of SSE deltas,
 * sent in small byte chunks that cut through lines and multi-byte characters.
 */
function streamedFetch(script, chunkBytes = 7) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    const deltas = script[requests.length - 1];
    if (!deltas) throw new Error('unexpected extra AI call');
    const sse = deltas.map((delta) => `data: ${JSON.stringify({ model: 'test-model', choices: [{ delta }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    const bytes = new TextEncoder().encode(sse);
    let at = 0;
    const body = new ReadableStream({
      pull(out) {
        if (at >= bytes.length) return out.close();
        out.enqueue(bytes.slice(at, at + chunkBytes));
        at += chunkBytes;
      }
    });
    return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body };
  };
  return { fetch, requests };
}

/**
 * Fake provider for runAgentTurn's tool loop: each send gets the next scripted reply
 * { text, toolCalls, pieces } (pieces, default the whole text, go to onText when the turn
 * streams). A function entry gets { timeoutMs, signal } and returns the reply or throws;
 * an Error entry is thrown. Records the turns it was started with, every send and every
 * batch of tool results.
 */
function scriptedProvider(script) {
  const turns = [];
  const sends = [];
  const results = [];
  const provider = (turn) => {
    turns.push(turn);
    return {
      async send(timeoutMs, { onText, signal } = {}) {
        const entry = script[sends.length];
        sends.push({ timeoutMs, streamed: typeof onText === 'function', signal });
        if (!entry) throw new Error('unexpected extra AI call');
        const reply = typeof entry === 'function' ? await entry({ timeoutMs, signal }) : entry;
        if (reply instanceof Error) throw reply;
        const { pieces, ...rest } = reply;
        const out = { text: '', toolCalls: [], model: 'fake-model', ...rest };
        if (onText) (pieces || (out.text ? [out.text] : [])).forEach((p) => onText(p));
        return out;
      },
      addToolResults(batch) {
        results.push(batch);
      }
    };
  };
  return { provider, turns, sends, results };
}

const call = (id, name, args) => ({ id, name, args });
const rateLimited = () => new Error('AI 사용량이 잠시 몰렸습니다. 잠시 후 다시 시도해 주세요.');

/** Set env vars for fn, restoring them afterwards (after the promise settles for async fn). */
function withEnv(vars, fn) {
  const saved = {};
  Object.keys(vars).forEach((k) => { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  const restore = () => Object.keys(saved).forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}

describe('agent tools', () => {
  it('every read tool calls a real service function and returns compact data', () => {
    const { api, hong, demo } = setup();
    const sid = hong.student_id;
    const args = {
      search_students: { query: '길동' },
      get_student_profile: { student_id: sid },
      get_attendance: { student_id: sid, month: '2026-09' },
      get_student_lessons: { student_id: sid },
      get_scores: { student_id: sid },
      get_homework_status: { student_id: sid },
      get_counseling_notes: { student_id: sid },
      get_today_board: {},
      list_classes: {},
      get_class_members: { class_id: demo.class.class_id }
    };
    assistantTools().filter((t) => t.kind === 'read').forEach((t) => {
      assert.ok(args[t.name], 'test args for ' + t.name);
      const out = t.call(api, args[t.name]);
      assert.ok(out !== undefined, t.name);
      assert.doesNotThrow(() => JSON.stringify(out), t.name);
    });
    const found = AGENT_TOOLS.find((t) => t.name === 'search_students').call(api, { query: '길동' });
    assert.equal(found.count, 1);
    assert.equal(found.students[0].student_id, sid);
    assert.deepEqual(found.students[0].classes, ['중2 A반']);
    const att = AGENT_TOOLS.find((t) => t.name === 'get_attendance').call(api, { student_id: sid, month: '2026-09' });
    assert.ok(att.days.some((d) => d.entries.some((e) => e.lesson_id)));
  });

  it('write tools are the registered write actions, with no direct call', () => {
    const writes = AGENT_TOOLS.filter((t) => t.kind === 'write');
    assert.deepEqual(writes.map((t) => t.name).sort(), LMS.agentActions.list().map((a) => a.name).sort());
    writes.forEach((t) => {
      const a = LMS.agentActions.get(t.name);
      assert.equal(typeof t.call, 'undefined', t.name);
      assert.equal(t.parameters, a.parameters, t.name);
      assert.equal(t.description, a.description, t.name);
      assert.deepEqual(t.surfaces, a.surfaces, t.name);
      if (t.surfaces.includes('assistant')) assert.match(t.description, /승인 필요/);
    });
  });

  it('builds OpenAI-style definitions and cuts long results', () => {
    const defs = toolDefinitions();
    assert.equal(defs.length, assistantTools().length);
    assert.deepEqual(defs.map((d) => d.function.name), assistantTools().map((t) => t.name));
    assert.ok(assistantTools().every((t) => t.surfaces.includes('assistant')));
    assert.ok(mcpTools().every((t) => t.surfaces.includes('mcp')));
    defs.forEach((d) => {
      assert.equal(d.type, 'function');
      assert.equal(d.function.parameters.type, 'object');
    });
    const long = toolResultText({ text: 'x'.repeat(TOOL_RESULT_MAX_CHARS * 2) });
    assert.ok(long.length < TOOL_RESULT_MAX_CHARS + 100);
    assert.match(long, /잘림/);
  });
});

describe('chatWithTools', () => {
  it('sends tools and parses tool calls', async () => {
    const { fetch, requests } = scriptedFetch([
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'search_students', { query: '민수' })] }
    ]);
    const res = await chatWithTools([{ role: 'user', content: 'hi' }], toolDefinitions(), { config: CONFIG, fetch });
    assert.equal(requests[0].tool_choice, 'auto');
    assert.ok(requests[0].tools.length > 0);
    assert.deepEqual(res.toolCalls, [{ id: 'c1', name: 'search_students', args: { query: '민수' } }]);
  });

});

describe('temperature by model', () => {
  const { chatCompletion, temperatureFor, isClaudeModel } = require('../lib/ai-client.js');
  const { buildMonthlyAiSections } = require('../lib/monthly-ai.js');
  const CLAUDE = { ...CONFIG, model: 'anthropic/claude-haiku-5.5' };
  const reply = () => scriptedFetch([{ role: 'assistant', content: '【학습 분석】\n좋음' }]);
  const hi = [{ role: 'user', content: 'hi' }];

  it('recognises Claude model IDs', () => {
    ['anthropic/claude-haiku-5.5', 'Anthropic/Claude-Sonnet-5.5', 'claude-haiku-5-5'].forEach((m) => assert.equal(isClaudeModel(m), true, m));
    ['openrouter/free', 'google/gemini-3.7-flash', 'openai/gpt-5.6-luna', ''].forEach((m) => assert.equal(isClaudeModel(m), false, m));
  });

  it('never sends temperature to Claude models, on any AI path', async () => {
    const tools = reply();
    await chatWithTools(hi, toolDefinitions(), { config: CLAUDE, fetch: tools.fetch, temperature: 0.5 });
    const plain = reply();
    await chatCompletion(hi, { config: CLAUDE, fetch: plain.fetch });
    const monthly = reply();
    await buildMonthlyAiSections({ student: { name: '가' } }, { config: CLAUDE, fetch: monthly.fetch });
    [tools, plain, monthly].forEach((r) => assert.equal('temperature' in r.requests[0], false));
  });

  it('keeps each feature temperature for other models', async () => {
    const tools = reply();
    await chatWithTools(hi, toolDefinitions(), { config: CONFIG, fetch: tools.fetch });
    const plain = reply();
    await chatCompletion(hi, { config: CONFIG, fetch: plain.fetch });
    const monthly = reply();
    await buildMonthlyAiSections({ student: { name: '가' } }, { config: CONFIG, fetch: monthly.fetch });
    assert.equal(tools.requests[0].temperature, 0.2);
    assert.equal(plain.requests[0].temperature, 0.3);
    assert.equal(monthly.requests[0].temperature, 0.4);
  });

  it('treats a null temperature as unset', async () => {
    assert.equal(temperatureFor(CONFIG, null, 0.2), 0.2);
    const tools = reply();
    await chatWithTools(hi, toolDefinitions(), { config: CONFIG, fetch: tools.fetch, temperature: null });
    assert.equal(tools.requests[0].temperature, 0.2);
  });

  it('streams text pieces to onText and joins tool call pieces', async () => {
    const { fetch, requests } = streamedFetch([[
      { role: 'assistant', content: '학생을 ' },
      { content: '찾아볼게요.' },
      { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'search_students', arguments: '{"qu' } }] },
      { tool_calls: [{ index: 1, id: 'c2', type: 'function', function: { name: 'get_today_board', arguments: '' } }] },
      { tool_calls: [{ index: 0, function: { arguments: 'ery":"민' } }] },
      { tool_calls: [{ index: 0, function: { arguments: '수"}' } }] },
      { tool_calls: [{ index: 1, function: { arguments: '{}' } }] }
    ]]);
    const pieces = [];
    const res = await chatWithTools([{ role: 'user', content: 'hi' }], toolDefinitions(), { config: CONFIG, fetch, onText: (t) => pieces.push(t) });
    assert.equal(requests[0].stream, true);
    assert.deepEqual(pieces, ['학생을 ', '찾아볼게요.']);
    assert.equal(res.text, '학생을 찾아볼게요.');
    assert.equal(res.model, 'test-model');
    assert.deepEqual(res.toolCalls, [
      { id: 'c1', name: 'search_students', args: { query: '민수' } },
      { id: 'c2', name: 'get_today_board', args: {} }
    ]);
    // The raw message goes back to the model in the next request, in the usual shape.
    assert.deepEqual(res.message.tool_calls.map((c) => [c.id, c.function.arguments]), [['c1', '{"query":"민수"}'], ['c2', '{}']]);
  });

  it('sends no stream flag without onText', async () => {
    const { fetch, requests } = scriptedFetch([{ role: 'assistant', content: '안녕하세요' }]);
    await chatWithTools([{ role: 'user', content: 'hi' }], toolDefinitions(), { config: CONFIG, fetch });
    assert.equal('stream' in requests[0], false);
  });

  it('keeps unreadable arguments visible', () => {
    assert.deepEqual(parseToolArguments('{bad'), { __unreadable: '{bad' });
    assert.deepEqual(parseToolArguments(''), {});
  });
});

describe('runAgentTurn', () => {
  it('answers a question with read tools and stores the conversation', async () => {
    const { api, hong, run } = setup();
    const ai = scriptedProvider([
      { toolCalls: [call('c1', 'search_students', { query: '홍길동' })] },
      { text: `홍길동 [[student:${hong.student_id}]] 학생을 찾았습니다.` }
    ]);
    const out = await runAgentTurn({ message: '홍길동 찾아줘' }, run, { provider: ai.provider });
    assert.match(out.message.content, /찾았습니다/);
    assert.equal(out.message.proposal, null);
    assert.equal(out.model, 'fake-model');
    assert.deepEqual(out.steps, [{ tool: 'search_students', kind: 'read', ok: true }]);
    // The provider gets the tool result before the next send.
    assert.equal(ai.sends.length, 2);
    assert.deepEqual(ai.results[0].map((r) => [r.id, r.isError]), [['c1', false]]);
    assert.match(ai.results[0][0].content, new RegExp(hong.student_id));
    assert.match(ai.turns[0].system, /오늘: 2026-09-14/);
    assert.equal(ai.turns[0].message, '홍길동 찾아줘');
    assert.deepEqual(ai.turns[0].history, []);

    const conv = api.getAgentConversation(out.conversation_id);
    assert.deepEqual(conv.messages.map((m) => m.role), ['user', 'assistant']);
    assert.equal(api.listAgentConversations()[0].title, '홍길동 찾아줘');
  });

  it('turns write tools into one pending proposal without changing data', async () => {
    const { api, hong, kim, lessonOf, run } = setup();
    const hongLesson = lessonOf(hong.student_id);
    const kimLesson = lessonOf(kim.student_id);
    const ai = scriptedProvider([
      {
        toolCalls: [
          call('w1', 'update_attendance', { lesson_id: hongLesson.lesson_id, attendance: '결석' }),
          call('w2', 'update_attendance', { lesson_id: kimLesson.lesson_id, attendance: '결석' }),
          call('w3', 'update_attendance', { lesson_id: hongLesson.lesson_id, attendance: '결석' }),
          call('w4', 'update_attendance', { lesson_id: 'LES-9999', attendance: '결석' })
        ]
      },
      { text: '두 학생 결석 처리를 승인해 주세요.' }
    ]);
    const out = await runAgentTurn({ message: '홍길동, 김철수 오늘 결석' }, run, { provider: ai.provider });
    const p = out.message.proposal;
    assert.equal(p.status, 'pending');
    assert.equal(p.calls.length, 2);
    assert.equal(p.calls[0].before, '출석');
    assert.equal(p.calls[0].after, '결석');
    assert.match(p.calls[0].text, /홍길동 · 2026-09-14 중2 A반 출결: 출석 → 결석/);
    // Nothing is saved before approval.
    assert.equal(lessonOf(hong.student_id).attendance, '출석');
    const results = ai.results[0].map((r) => JSON.parse(r.content.replace(/….*$/, '')));
    assert.match(results[2].status, /이미/);
    assert.match(results[3].error, /찾을 수 없습니다/);
    assert.deepEqual(ai.results[0].map((r) => r.isError), [false, false, false, true]);
    assert.equal(out.steps[3].ok, false);

    const applied = await applyProposal(p.proposal_id, run);
    assert.equal(applied.status, 'applied');
    assert.equal(applied.verification_status, 'verified');
    assert.equal(lessonOf(hong.student_id).attendance, '결석');
    assert.equal(lessonOf(kim.student_id).attendance, '결석');
    // Approving again runs nothing twice.
    const again = await applyProposal(p.proposal_id, run);
    assert.equal(again.executed_at, applied.executed_at);
    assert.equal(api.getAgentConversation(out.conversation_id).messages[1].proposal.status, 'applied');
  });

  it('continues a conversation with its history', async () => {
    const { run } = setup();
    const first = scriptedProvider([{ text: '어느 학생인가요?' }]);
    const a = await runAgentTurn({ message: '민수 찾아줘' }, run, { provider: first.provider });
    const second = scriptedProvider([{ text: '알겠습니다.' }]);
    await runAgentTurn({ conversationId: a.conversation_id, message: '중2 학생이요' }, run, { provider: second.provider });
    const { history, message } = second.turns[0];
    assert.deepEqual(history.map((m) => [m.role, m.content]), [['user', '민수 찾아줘'], ['assistant', '어느 학생인가요?']]);
    assert.equal(message, '중2 학생이요');
  });

  it('stops after the step limit and says so', async () => {
    const { run } = setup();
    const loop = { toolCalls: [call('c', 'list_classes', {})] };
    const ai = scriptedProvider([loop, loop]);
    const out = await runAgentTurn({ message: '반 목록' }, run, { provider: ai.provider, maxSteps: 2 });
    assert.equal(ai.sends.length, 2);
    assert.match(out.message.content, /끝까지 처리하지 못했습니다/);
  });

  it('gives each step the time left in the budget', async () => {
    const { run } = setup();
    const ai = scriptedProvider([{ toolCalls: [call('c', 'list_classes', {})] }, { text: '네' }]);
    await runAgentTurn({ message: '반 목록' }, run, { provider: ai.provider, budgetMs: 30000 });
    assert.ok(ai.sends[0].timeoutMs <= 30000 && ai.sends[0].timeoutMs > 25000);
    assert.ok(ai.sends[1].timeoutMs <= ai.sends[0].timeoutMs);

    // Less than one step's minimum left: no AI call at all.
    const short = scriptedProvider([]);
    const out = await runAgentTurn({ message: '반 목록' }, run, { provider: short.provider, budgetMs: 1000 });
    assert.equal(short.sends.length, 0);
    assert.match(out.message.content, /끝까지 처리하지 못했습니다/);
  });

  it('marks unknown tools and unreadable arguments as errors without running them', async () => {
    const { run } = setup();
    const ai = scriptedProvider([
      { toolCalls: [call('x1', 'delete_everything', {}), call('x2', 'search_students', { __unreadable: '{bad' })] },
      { text: '다시 해 볼게요.' }
    ]);
    const out = await runAgentTurn({ message: '...' }, run, { provider: ai.provider });
    assert.deepEqual(out.steps, [
      { tool: 'delete_everything', kind: 'unknown', ok: false },
      { tool: 'search_students', kind: 'read', ok: false }
    ]);
    const [unknown, unreadable] = ai.results[0].map((r) => JSON.parse(r.content).error);
    assert.match(unknown, /없는 도구입니다: delete_everything/);
    assert.match(unreadable, /JSON으로 읽을 수 없습니다/);
  });

  it('passes AI errors through without saving the turn', async () => {
    const { api, run } = setup();
    const ai = scriptedProvider([rateLimited()]);
    await assert.rejects(runAgentTurn({ message: '안녕' }, run, { provider: ai.provider }), /잠시 후/);
    assert.equal(api.listAgentConversations().length, 0);
  });

  it('keeps the turn when the data changes during the AI wait', async () => {
    const { store, hong, kim, lessonOf } = setup();
    // Like withService: every step reads the store again.
    const run = async (fn) => fn(LMS.createService(store));
    const hongLesson = lessonOf(hong.student_id);
    const kimLesson = lessonOf(kim.student_id);
    const ai = scriptedProvider([
      {
        toolCalls: [
          call('w1', 'update_attendance', { lesson_id: hongLesson.lesson_id, attendance: '결석' }),
          call('w2', 'update_attendance', { lesson_id: kimLesson.lesson_id, attendance: '결석' })
        ]
      },
      () => {
        // Kim's lesson is deleted on another screen while the model writes its reply.
        store.writeTable('Lessons', store.readTable('Lessons').filter((l) => l.lesson_id !== kimLesson.lesson_id));
        return { text: '두 학생 결석 처리를 승인해 주세요.' };
      }
    ]);
    const out = await runAgentTurn({ message: '홍길동, 김철수 오늘 결석' }, run, { provider: ai.provider });
    assert.equal(out.message.proposal.status, 'pending');
    assert.equal(out.message.proposal.calls.length, 2);
    const conv = LMS.createService(store).getAgentConversation(out.conversation_id);
    assert.deepEqual(conv.messages.map((m) => m.role), ['user', 'assistant']);

    // Approval checks again and refuses the stale change; nothing is applied.
    await assert.rejects(applyProposal(out.message.proposal.proposal_id, run), /찾을 수 없습니다/);
    const after = LMS.createService(store);
    assert.equal(after.getStudentLessons(hong.student_id, '2026-09-14', '2026-09-14')[0].attendance, '출석');
    assert.equal(after.getAgentConversation(out.conversation_id).messages[1].proposal.status, 'failed');
  });

  it('flags a removed conversation with a code and counts nothing', async () => {
    const { api, store, run } = setup();
    const ai = scriptedProvider([]);
    await assert.rejects(runAgentTurn({ conversationId: 'AGC-9999', message: '안녕' }, run, { provider: ai.provider, rateLimit: 5 }), (e) => {
      assert.equal(e.code, 'CONVERSATION_NOT_FOUND');
      assert.match(e.message, /대화를 찾을 수 없습니다/);
      return true;
    });
    assert.throws(() => api.getAgentConversation('AGC-9999'), (e) => e.code === 'CONVERSATION_NOT_FOUND');
    assert.equal(ai.turns.length, 0);
    assert.equal(store.readTable('AgentUsage').length, 0);
  });

  it('reports steps and streamed text in order, dropping text that came before tool calls', async () => {
    const { run } = setup();
    const ai = scriptedProvider([
      { text: '찾아볼게요.', toolCalls: [call('c1', 'search_students', { query: '홍길동' }), call('c2', 'get_scores', { student_id: 'STU-9999' })] },
      { text: '홍길동 학생을 찾았습니다.', pieces: ['홍길동 학생을 ', '찾았습니다.'] }
    ]);
    const events = [];
    const out = await runAgentTurn({ message: '홍길동 찾아줘' }, run, { provider: ai.provider, onEvent: (e) => events.push(e) });
    assert.deepEqual(events, [
      { type: 'text', delta: '찾아볼게요.' },
      { type: 'text_reset' },
      { type: 'step', id: 'c1', tool: 'search_students', label: '학생 검색 중', state: 'running' },
      { type: 'step', id: 'c1', tool: 'search_students', label: '학생 검색 중', state: 'done', ok: true },
      { type: 'step', id: 'c2', tool: 'get_scores', label: '성적 확인 중', state: 'running' },
      { type: 'step', id: 'c2', tool: 'get_scores', label: '성적 확인 중', state: 'done', ok: false },
      { type: 'text', delta: '홍길동 학생을 ' },
      { type: 'text', delta: '찾았습니다.' },
      { type: 'saving' }
    ]);
    assert.equal(out.message.content, '홍길동 학생을 찾았습니다.');
    assert.deepEqual(out.steps.map((s) => s.ok), [true, false]);
    assert.deepEqual(ai.sends.map((s) => s.streamed), [true, true]);

    // Without onEvent the provider is not asked to stream.
    const plain = scriptedProvider([{ text: '네' }]);
    await runAgentTurn({ message: '안녕' }, run, { provider: plain.provider });
    assert.equal(plain.sends[0].streamed, false);
  });

  it('stops on abort, gives the slot back and saves nothing', async () => {
    const { store, hong, lessonOf, run } = setup();
    const now = Date.parse('2026-09-14T01:00:00Z');
    const saved = () => ['AgentUsage', 'AgentConversations', 'AgentMessages', 'AgentProposals'].map((t) => store.readTable(t).length);

    // Stopped after a change was collected, while the model writes its reply.
    // The reply still arrives, but the turn checks the signal before saving.
    const controller = new AbortController();
    const ai = scriptedProvider([
      { toolCalls: [call('w1', 'update_attendance', { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' })] },
      () => {
        controller.abort();
        return { text: '승인해 주세요.' };
      }
    ]);
    await assert.rejects(runAgentTurn({ message: '홍길동 결석' }, run, { provider: ai.provider, rateLimit: 5, now, signal: controller.signal }),
      (e) => e.code === 'REQUEST_ABORTED');
    assert.deepEqual(saved(), [0, 0, 0, 0]);

    // Stopped while the AI request is in flight: the provider gets the signal and gives up.
    const inflight = new AbortController();
    const hanging = scriptedProvider([({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(abortedError()));
      inflight.abort();
    })]);
    await assert.rejects(runAgentTurn({ message: '안녕' }, run, { provider: hanging.provider, rateLimit: 5, now, signal: inflight.signal }),
      (e) => e.code === 'REQUEST_ABORTED');
    assert.deepEqual(saved(), [0, 0, 0, 0]);
    assert.equal(lessonOf(hong.student_id).attendance, '출석');

    // Already stopped: the provider is never started.
    const idle = scriptedProvider([]);
    await assert.rejects(runAgentTurn({ message: '안녕' }, run, { provider: idle.provider, signal: inflight.signal }), (e) => e.code === 'REQUEST_ABORTED');
    assert.equal(idle.turns.length, 0);
  });

  it('a saved turn can be found again by the browser\'s turn id', async () => {
    const { api, run } = setup();
    const ai = scriptedProvider([{ text: '네' }]);
    const out = await runAgentTurn({ message: '안녕', clientTurnId: 'turn-1' }, run, { provider: ai.provider });
    assert.deepEqual(api.findAgentTurn('turn-1'), { conversation_id: out.conversation_id });
    assert.equal(api.findAgentTurn('turn-2'), null);
    assert.equal(api.findAgentTurn(''), null);
  });
});

describe('agent rate limit', () => {
  const HOUR = 60 * 60 * 1000;
  const T0 = Date.parse('2026-09-14T01:00:00Z');

  it('allows the limit per hour, then refuses before calling the AI', async () => {
    const { api, store, run } = setup();
    const replies = scriptedProvider([{ text: '하나' }, { text: '둘' }]);
    await runAgentTurn({ message: '1' }, run, { provider: replies.provider, rateLimit: 2, now: T0 });
    await runAgentTurn({ message: '2' }, run, { provider: replies.provider, rateLimit: 2, now: T0 + 10 * 60000 });
    await assert.rejects(runAgentTurn({ message: '3' }, run, { provider: replies.provider, rateLimit: 2, now: T0 + 20 * 60000 }), (e) => {
      assert.equal(e.code, AGENT_RATE_LIMITED);
      assert.match(e.message, /한 시간에 2번까지.*약 40분 뒤/);
      return true;
    });
    assert.equal(replies.sends.length, 2);
    assert.equal(api.listAgentConversations().length, 2);
    assert.equal(store.readTable('AgentUsage').length, 2);

    // An hour after the first turn, one slot is free again; old rows are dropped.
    const later = scriptedProvider([{ text: '셋' }]);
    await runAgentTurn({ message: '3' }, run, { provider: later.provider, rateLimit: 2, now: T0 + HOUR + 1 });
    assert.deepEqual(store.readTable('AgentUsage').map((u) => u.used_at), [T0 + 10 * 60000, T0 + HOUR + 1]);
  });

  it('concurrent turns never pass the limit', async () => {
    const { api, store } = setup();
    // withService serializes whole steps (advisory lock); turns still interleave between steps.
    const run = async (fn) => {
      await new Promise((r) => setImmediate(r));
      return fn(LMS.createService(store));
    };
    const { provider } = scriptedProvider([1, 2, 3].map((n) => ({ text: String(n) })));
    const results = await Promise.allSettled([1, 2, 3].map((n) =>
      runAgentTurn({ message: String(n) }, run, { provider, rateLimit: 2, now: T0 + n })));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
    assert.equal(results.filter((r) => r.status === 'rejected' && r.reason.code === AGENT_RATE_LIMITED).length, 1);
    assert.equal(store.readTable('AgentUsage').length, 2);
    assert.equal(api.listAgentConversations().length, 2);
  });

  it('gives the slot back when the AI call fails', async () => {
    const { api, store, run } = setup();
    const { provider } = scriptedProvider([rateLimited()]);
    await assert.rejects(runAgentTurn({ message: '안녕' }, run, { provider, rateLimit: 2, now: T0 }), /잠시 후/);
    assert.equal(store.readTable('AgentUsage').length, 0);
    assert.equal(api.listAgentConversations().length, 0);
  });

  it('gives the slot back when the turn cannot be saved', async () => {
    const { store } = setup();
    const run = async (fn) => fn(LMS.createService(store));
    const first = scriptedProvider([{ text: '어느 학생인가요?' }]);
    const a = await runAgentTurn({ message: '민수 찾아줘' }, run, { provider: first.provider, rateLimit: 5, now: T0 });
    assert.equal(store.readTable('AgentUsage').length, 1);
    const second = scriptedProvider([() => {
      // The conversation is removed while the model answers.
      store.writeTable('AgentConversations', []);
      return { text: '알겠습니다.' };
    }]);
    await assert.rejects(runAgentTurn({ conversationId: a.conversation_id, message: '중2 학생이요' }, run, { provider: second.provider, rateLimit: 5, now: T0 + 60000 }),
      (e) => e.code === 'CONVERSATION_NOT_FOUND');
    assert.deepEqual(store.readTable('AgentUsage').map((u) => u.used_at), [T0]);
  });

  it('keeps the slot of a saved turn', async () => {
    const { store, run } = setup();
    const { provider } = scriptedProvider([{ text: '안녕하세요' }]);
    await runAgentTurn({ message: '안녕' }, run, { provider, rateLimit: 2, now: T0 });
    assert.deepEqual(store.readTable('AgentUsage').map((u) => u.used_at), [T0]);
  });

  it('counts nothing when the limit is 0', async () => {
    const { store, run } = setup();
    const { provider } = scriptedProvider([{ text: '안녕하세요' }]);
    await runAgentTurn({ message: '안녕' }, run, { provider, rateLimit: 0 });
    assert.equal(store.readTable('AgentUsage').length, 0);
  });

  it('reads AGENT_RATE_LIMIT_PER_HOUR with a default of 60', () => {
    assert.equal(agentRateLimit(undefined), 60);
    assert.equal(agentRateLimit(''), 60);
    assert.equal(agentRateLimit('20'), 20);
    assert.equal(agentRateLimit('0'), 0);
    assert.equal(agentRateLimit('-1'), 60);
    assert.equal(agentRateLimit('abc'), 60);
  });
});

describe('agent proposals', () => {
  function proposalWith(api, calls) {
    return api.saveAgentTurn({ message: '요청', reply: '승인해 주세요', calls }).message.proposal;
  }

  it('creates a counseling note with a follow-up task and verifies it', () => {
    const { api, hong } = setup();
    const p = proposalWith(api, [{
      tool: 'create_counseling',
      args: { student_id: hong.student_id, kind: '학부모', counsel_date: '2026-09-14', content: '숙제 관리 요청', follow_up_date: '2026-09-21' }
    }]);
    assert.match(p.calls[0].text, /홍길동 · 2026-09-14 학부모 상담 기록 추가 \(후속: 2026-09-21 학부모 후속 연락\)/);
    const applied = api.applyAgentProposal(p.proposal_id);
    assert.equal(applied.verification_status, 'verified');
    const notes = api.getCounselingNotes(hong.student_id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0].content, '숙제 관리 요청');
    assert.equal(notes[0].follow_up_status, '예정');
  });

  it('marks tasks done', () => {
    const { api, hong } = setup();
    const note = api.saveCounselingNote({ student_id: hong.student_id, kind: '학생', counsel_date: '2026-09-14', content: '상담', follow_up_date: '2026-09-20' });
    const p = proposalWith(api, [{ tool: 'update_task_status', args: { task_id: note.follow_up_task_id, status: '완료' } }]);
    assert.equal(p.calls[0].before, '예정');
    api.applyAgentProposal(p.proposal_id);
    assert.equal(api.getCounselingNotes(hong.student_id)[0].follow_up_status, '완료');
  });

  it('rejects invalid changes when the proposal is made', () => {
    const { api, hong, lessonOf } = setup();
    assert.throws(() => proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '지각' } }]), /출석/);
    assert.throws(() => proposalWith(api, [{ tool: 'delete_student', args: {} }]), /지원하지 않는/);
    assert.equal(api.listAgentConversations().length, 0);
  });

  it('undoes every change when one fails, then records the failure', async () => {
    const { api, store, hong, kim, lessonOf, run } = setup();
    const p = proposalWith(api, [
      { tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } },
      { tool: 'update_attendance', args: { lesson_id: lessonOf(kim.student_id).lesson_id, attendance: '결석' } }
    ]);
    // The second lesson disappears between proposal and approval.
    const kimId = lessonOf(kim.student_id).lesson_id;
    store.writeTable('Lessons', store.readTable('Lessons').filter((l) => l.lesson_id !== kimId));
    const fresh = LMS.createService(store);
    await assert.rejects(applyProposal(p.proposal_id, async (fn) => fn(fresh)), /찾을 수 없습니다/);
    assert.equal(fresh.getStudentLessons(hong.student_id, '2026-09-14', '2026-09-14')[0].attendance, '출석');
    const conv = fresh.getAgentConversation(p.conversation_id);
    assert.equal(conv.messages[1].proposal.status, 'failed');
    assert.match(conv.messages[1].proposal.result.error, /찾을 수 없습니다/);
    void run;
  });

  it('applies only the selected changes and records the rest as skipped', async () => {
    const { api, hong, kim, lessonOf, run } = setup();
    const p = proposalWith(api, [
      { tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } },
      { tool: 'update_attendance', args: { lesson_id: lessonOf(kim.student_id).lesson_id, attendance: '결석' } },
      { tool: 'create_counseling', args: { student_id: hong.student_id, kind: '학생', counsel_date: '2026-09-14', content: '결석 사유 확인' } }
    ]);
    const statusOf = () => api.getAgentConversation(p.conversation_id).messages[1].proposal.status;

    // An empty choice is refused and the proposal stays pending.
    await assert.rejects(applyProposal(p.proposal_id, run, []), /하나 이상/);
    await assert.rejects(applyProposal(p.proposal_id, run, [7]), (e) => e.code === 'AGENT_NOTHING_SELECTED');
    assert.throws(() => api.applyAgentProposal(p.proposal_id, []), (e) => e.code === 'AGENT_NOTHING_SELECTED');
    assert.equal(statusOf(), 'pending');
    assert.equal(lessonOf(hong.student_id).attendance, '출석');

    const applied = await applyProposal(p.proposal_id, run, [0, 2]);
    assert.equal(applied.status, 'applied');
    assert.equal(applied.verification_status, 'verified');
    assert.equal(applied.result.length, 3);
    assert.equal(applied.result[0].ok, true);
    assert.deepEqual(applied.result[1], { tool: 'update_attendance', text: p.calls[1].text, skipped: true });
    assert.equal(applied.result[2].ok, true);
    assert.equal(lessonOf(hong.student_id).attendance, '결석');
    assert.equal(lessonOf(kim.student_id).attendance, '출석');
    assert.equal(api.getCounselingNotes(hong.student_id).length, 1);
    assert.equal(statusOf(), 'applied');
  });

  it('rejects once and refuses to apply a rejected proposal', () => {
    const { api, hong, lessonOf } = setup();
    const p = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } }]);
    assert.equal(api.rejectAgentProposals([p.proposal_id])[0].proposal.status, 'rejected');
    assert.throws(() => api.applyAgentProposal(p.proposal_id), /이미 처리된/);
    assert.equal(lessonOf(hong.student_id).attendance, '출석');
  });
});

describe('agent proposal batches', () => {
  function proposalWith(api, calls) {
    return api.saveAgentTurn({ message: '요청', reply: '승인해 주세요', calls }).message.proposal;
  }
  const statusOf = (api, p) => api.getAgentConversation(p.conversation_id).messages[1].proposal.status;

  it('lists only pending proposals, oldest first', () => {
    const { api, store, hong, kim, lessonOf } = setup();
    const a = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } }]);
    const b = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(kim.student_id).lesson_id, attendance: '결석' } }]);
    const c = proposalWith(api, [{ tool: 'create_counseling', args: { student_id: hong.student_id, kind: '학생', counsel_date: '2026-09-14', content: '상담' } }]);
    const d = proposalWith(api, [{ tool: 'create_counseling', args: { student_id: kim.student_id, kind: '학생', counsel_date: '2026-09-14', content: '상담' } }]);
    // Creation times run against the id order: c, a, d, b.
    const times = { [c.proposal_id]: '2026-09-14T01:00:00', [a.proposal_id]: '2026-09-14T02:00:00', [d.proposal_id]: '2026-09-14T03:00:00', [b.proposal_id]: '2026-09-14T04:00:00' };
    store.writeTable('AgentProposals', store.readTable('AgentProposals').map((p) => ({ ...p, created_at: times[p.proposal_id] })));
    const fresh = LMS.createService(store);
    fresh.rejectAgentProposals([d.proposal_id]);

    const list = fresh.listPendingProposals();
    assert.deepEqual(list.map((p) => p.proposal_id), [c.proposal_id, a.proposal_id, b.proposal_id]);
    assert.equal(list[0].title, '요청');
    assert.equal(list[0].calls.length, 1);
    assert.match(list[0].calls[0].text, /상담/);
    assert.equal(list[0].calls[0].args, undefined);
  });

  it('applies each proposal on its own: a broken one fails, the others keep their changes', async () => {
    const { api, store, hong, kim, lessonOf } = setup();
    const kimId = lessonOf(kim.student_id).lesson_id;
    const first = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } }]);
    const broken = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: kimId, attendance: '결석' } }]);
    const last = proposalWith(api, [{ tool: 'create_counseling', args: { student_id: hong.student_id, kind: '학생', counsel_date: '2026-09-14', content: '결석 사유 확인' } }]);
    // The middle proposal's lesson disappears before approval.
    store.writeTable('Lessons', store.readTable('Lessons').filter((l) => l.lesson_id !== kimId));
    const fresh = LMS.createService(store);
    const run = async (fn) => fn(fresh);

    const { results } = await applyProposals([last.proposal_id, broken.proposal_id, first.proposal_id], run);
    assert.deepEqual(results.map((r) => [r.proposal_id, r.status]), [
      [first.proposal_id, 'applied'], [broken.proposal_id, 'failed'], [last.proposal_id, 'applied']
    ]);
    assert.equal(results[0].verification_status, 'verified');
    assert.equal(results[0].error, '');
    assert.match(results[1].error, /찾을 수 없습니다/);
    assert.equal(fresh.getStudentLessons(hong.student_id, '2026-09-14', '2026-09-14')[0].attendance, '결석');
    assert.equal(fresh.getCounselingNotes(hong.student_id).length, 1);
    assert.equal(statusOf(fresh, broken), 'failed');
    assert.equal(fresh.listPendingProposals().length, 0);
  });

  it('reports the stored status of a proposal rejected after the order lookup', async () => {
    const { api, hong, lessonOf } = setup();
    const p = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } }]);
    let step = 0;
    const racing = async (fn) => {
      const out = await fn(api);
      if (step++ === 0) api.rejectAgentProposals([p.proposal_id]);
      return out;
    };
    const { results } = await applyProposals([p.proposal_id], racing);
    assert.equal(results[0].status, 'rejected');
    assert.match(results[0].error, /이미 처리된/);
    assert.equal(statusOf(api, p), 'rejected');
    assert.equal(lessonOf(hong.student_id).attendance, '출석');
  });

  it('refuses an empty or oversized list without touching any proposal', async () => {
    const { api, hong, lessonOf, run } = setup();
    const p = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } }]);
    const tooMany = Array.from({ length: PROPOSAL_BATCH_MAX + 1 }, (_, i) => i === 0 ? p.proposal_id : 'AGP-X' + i);
    for (const fn of [applyProposals, rejectProposals]) {
      await assert.rejects(fn([], run), /하나 이상/);
      await assert.rejects(fn(['', '  '], run), /하나 이상/);
      await assert.rejects(fn(null, run), /하나 이상/);
      await assert.rejects(fn(tooMany, run), new RegExp(`${PROPOSAL_BATCH_MAX}건까지`));
    }
    assert.equal(statusOf(api, p), 'pending');
    assert.equal(lessonOf(hong.student_id).attendance, '출석');
  });

  it('rejects only the chosen proposals and leaves the rest pending', async () => {
    const { api, hong, kim, lessonOf, run } = setup();
    const a = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } }]);
    const b = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(kim.student_id).lesson_id, attendance: '결석' } }]);
    const c = proposalWith(api, [{ tool: 'create_counseling', args: { student_id: hong.student_id, kind: '학생', counsel_date: '2026-09-14', content: '상담' } }]);
    await applyProposal(c.proposal_id, run);

    const { results } = await rejectProposals([b.proposal_id, c.proposal_id, 'AGP-NOPE', b.proposal_id], run);
    assert.deepEqual(results.map((r) => [r.proposal_id, r.status]), [
      [b.proposal_id, 'rejected'], [c.proposal_id, 'applied'], ['AGP-NOPE', '']
    ]);
    assert.equal(results[0].error, '');
    assert.match(results[1].error, /이미 처리된/);
    assert.match(results[2].error, /찾을 수 없습니다/);
    assert.equal(statusOf(api, a), 'pending');
    assert.equal(statusOf(api, b), 'rejected');
    assert.equal(statusOf(api, c), 'applied');
    assert.deepEqual(api.listPendingProposals().map((p) => p.proposal_id), [a.proposal_id]);
    assert.equal(lessonOf(kim.student_id).attendance, '출석');

    // Rejecting again is harmless.
    const again = await rejectProposals([b.proposal_id], run);
    assert.deepEqual(again.results, [{ proposal_id: b.proposal_id, status: 'rejected', verification_status: '', error: '' }]);
  });
});

describe('agent model setting', () => {
  const { getAgentAiConfig } = require('../lib/ai-client.js');


  it('uses AGENT_MODEL for the assistant only', () => {
    withEnv({ AI_API_KEY: 'k', AI_MODEL: 'report-model', AGENT_MODEL: 'tool-model' }, () => {
      assert.equal(getAgentAiConfig().model, 'tool-model');
      assert.equal(require('../lib/ai-client.js').getAiConfig().model, 'report-model');
    });
  });

  it('falls back to AI_MODEL when AGENT_MODEL is blank', () => {
    withEnv({ AI_API_KEY: 'k', AI_MODEL: 'report-model', AGENT_MODEL: '' }, () => {
      assert.equal(getAgentAiConfig().model, 'report-model');
    });
  });

  it('sends AGENT_MODEL in the chat request', async () => {
    const { run } = setup();
    const { fetch, requests } = scriptedFetch([{ role: 'assistant', content: '안녕하세요' }]);
    await withEnv({ AI_API_KEY: 'k', AI_MODEL: 'report-model', AGENT_MODEL: 'tool-model', AI_BASE_URL: 'https://ai.test/v1', ANTHROPIC_API_KEY: undefined }, () =>
      runAgentTurn({ message: '안녕' }, run, { fetch }));
    assert.equal(requests[0].model, 'tool-model');
  });
});

describe('OpenAI-compatible provider', () => {
  const { createOpenAiProvider } = require('../lib/agent-openai.js');
  const turn = {
    system: '시스템',
    history: [{ role: 'user', content: '전 질문' }, { role: 'assistant', content: '전 답' }],
    message: '홍길동 찾아줘'
  };

  it('sends the turn, then the tool calls and results in the chat completions shape', async () => {
    const { fetch, requests } = scriptedFetch([
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'search_students', { query: '홍길동' })] },
      { role: 'assistant', content: '찾았습니다.' }
    ]);
    const provider = createOpenAiProvider(turn, { config: CONFIG, fetch });
    const first = await provider.send(30000);
    assert.deepEqual(first, { text: '', toolCalls: [{ id: 'c1', name: 'search_students', args: { query: '홍길동' } }], model: 'test-model' });
    provider.addToolResults([{ id: 'c1', content: '{"count":1}', isError: false }]);
    const second = await provider.send(30000);
    assert.deepEqual(second, { text: '찾았습니다.', toolCalls: [], model: 'test-model' });

    assert.deepEqual(requests[0].messages.map((m) => [m.role, m.content]), [
      ['system', '시스템'], ['user', '전 질문'], ['assistant', '전 답'], ['user', '홍길동 찾아줘']
    ]);
    assert.ok(requests[0].tools.every((t) => t.type === 'function'));
    const [assistant, result] = requests[1].messages.slice(-2);
    assert.deepEqual(assistant, { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'search_students', { query: '홍길동' })] });
    assert.deepEqual(result, { role: 'tool', tool_call_id: 'c1', content: '{"count":1}' });
  });

  it('streams text pieces to onText', async () => {
    const { fetch, requests } = streamedFetch([[{ role: 'assistant', content: '홍길동 학생을 ' }, { content: '찾았습니다.' }]]);
    const pieces = [];
    const res = await createOpenAiProvider(turn, { config: CONFIG, fetch }).send(30000, { onText: (t) => pieces.push(t) });
    assert.equal(requests[0].stream, true);
    assert.deepEqual(pieces, ['홍길동 학생을 ', '찾았습니다.']);
    assert.equal(res.text, '홍길동 학생을 찾았습니다.');
  });

  it('cancels the request in flight when the signal stops', async () => {
    const controller = new AbortController();
    const hanging = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      controller.abort();
    });
    await assert.rejects(createOpenAiProvider(turn, { config: CONFIG, fetch: hanging }).send(30000, { signal: controller.signal }),
      (e) => e.code === 'REQUEST_ABORTED');
  });

  it('maps HTTP errors to Korean messages', async () => {
    const { fetch } = scriptedFetch([{ status: 429 }]);
    await assert.rejects(createOpenAiProvider(turn, { config: CONFIG, fetch }).send(30000), /잠시 후/);
  });

  it('runs a whole turn when runAgentTurn gets an OpenRouter config', async () => {
    const { hong, run } = setup();
    const { fetch, requests } = scriptedFetch([
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'search_students', { query: '홍길동' })] },
      { role: 'assistant', content: '홍길동 학생을 찾았습니다.' }
    ]);
    const out = await withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' }, () =>
      runAgentTurn({ message: '홍길동 찾아줘' }, run, { config: CONFIG, fetch }));
    assert.equal(out.message.content, '홍길동 학생을 찾았습니다.');
    assert.equal(out.model, 'test-model');
    assert.match(requests[0].messages[0].content, /오늘: 2026-09-14/);
    assert.match(requests[1].messages.at(-1).content, new RegExp(hong.student_id));
  });
});

describe('agent conversation cleanup', () => {
  it('drops conversations untouched for 90 days unless a change is still pending', () => {
    const { api, store, hong, lessonOf } = setup();
    const old = api.saveAgentTurn({ message: '오래된 대화', reply: '답' });
    const oldPending = api.saveAgentTurn({
      message: '오래된 승인 대기', reply: '승인해 주세요',
      calls: [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } }]
    });
    const recent = api.saveAgentTurn({ message: '최근 대화', reply: '답' });
    // Age the first two: last touched 91 days before today (2026-09-14).
    store.writeTable('AgentConversations', store.readTable('AgentConversations').map((c) =>
      c.conversation_id === recent.conversation_id ? c : { ...c, updated_at: '2026-06-15T09:00:00' }));
    const fresh = LMS.createService(store);
    fresh.saveAgentTurn({ message: '새 대화', reply: '답' });

    const ids = fresh.listAgentConversations().map((c) => c.conversation_id);
    assert.ok(!ids.includes(old.conversation_id));
    assert.ok(ids.includes(oldPending.conversation_id));
    assert.ok(ids.includes(recent.conversation_id));
    assert.equal(store.readTable('AgentMessages').filter((m) => m.conversation_id === old.conversation_id).length, 0);
    assert.equal(store.readTable('AgentProposals').length, 1);
  });

  it('keeps conversations exactly 90 days old', () => {
    const { api, store } = setup();
    const edge = api.saveAgentTurn({ message: '90일 전', reply: '답' });
    store.writeTable('AgentConversations', store.readTable('AgentConversations').map((c) => ({ ...c, updated_at: '2026-06-16T09:00:00' })));
    LMS.createService(store).saveAgentTurn({ message: '새 대화', reply: '답' });
    assert.ok(LMS.createService(store).listAgentConversations().some((c) => c.conversation_id === edge.conversation_id));
  });
});

describe('Anthropic API provider', () => {
  // Same (ESM) build of the SDK that lib/agent-anthropic.js imports, so error classes match.
  const sdk = () => import('@anthropic-ai/sdk').then((m) => m.default);
  const { anthropicModelId, anthropicToolDefinitions, anthropicErrorMessage, createAnthropicProvider } = require('../lib/agent-anthropic.js');
  const { getAgentProvider, isAgentConfigured } = require('../lib/ai-client.js');

  /**
   * Fake client: each messages.create or messages.stream call gets the next scripted response.
   * A streamed response sends its `pieces` (default: each text block) as text deltas; a
   * function entry gets (params, opts) and returns the response or throws.
   */
  function fakeClient(script) {
    const requests = [];
    const next = (params, opts, streamed) => {
      requests.push({ params: JSON.parse(JSON.stringify(params)), opts, streamed });
      const entry = script[requests.length - 1];
      if (!entry) throw new Error('unexpected extra AI call');
      return entry;
    };
    return {
      requests,
      messages: {
        create: async (params, opts) => {
          let entry = next(params, opts, false);
          if (typeof entry === 'function') entry = await entry(params, opts);
          if (entry instanceof Error) throw entry;
          return { model: 'claude-haiku-5-5', ...entry };
        },
        stream: (params, opts) => {
          const entry = next(params, opts, true);
          const final = (async () => {
            const res = typeof entry === 'function' ? await entry(params, opts) : entry;
            if (res instanceof Error) throw res;
            return { model: 'claude-haiku-5-5', ...res };
          })();
          final.catch(() => {});
          return {
            async *[Symbol.asyncIterator]() {
              const res = await final;
              const pieces = res.pieces || res.content.filter((b) => b.type === 'text').map((b) => b.text);
              for (const text of pieces) yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
            },
            finalMessage: () => final.then(({ pieces, ...res }) => res)
          };
        }
      }
    };
  }
  const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const thinking = { type: 'thinking', thinking: '', signature: 'sig' };

  const turn = (message = '안녕') => ({ system: '시스템', history: [], message });

  it('sends the documented request shape and returns every tool result in one user message', async () => {
    const client = fakeClient([
      { stop_reason: 'tool_use', content: [thinking, toolUse('t1', 'search_students', { query: '홍길동' }), toolUse('t2', 'get_scores', { student_id: 'STU-9999' })] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '홍길동 학생을 찾았습니다.' }] }
    ]);
    const history = [{ role: 'user', content: '전 질문' }, { role: 'assistant', content: '전 답' }];
    const provider = createAnthropicProvider({ system: '시스템', history, message: '홍길동 찾아줘' }, { client });
    const first = await provider.send(30000);
    assert.deepEqual(first, {
      text: '',
      toolCalls: [{ id: 't1', name: 'search_students', args: { query: '홍길동' } }, { id: 't2', name: 'get_scores', args: { student_id: 'STU-9999' } }],
      model: 'claude-haiku-5-5'
    });
    provider.addToolResults([{ id: 't1', content: '{"count":1}', isError: false }, { id: 't2', content: '{"error":"없음"}', isError: true }]);
    const second = await provider.send(30000);
    assert.deepEqual(second, { text: '홍길동 학생을 찾았습니다.', toolCalls: [], model: 'claude-haiku-5-5' });

    const [a, b] = client.requests;
    assert.equal(a.params.model, 'claude-haiku-5-5');
    assert.equal(a.params.system, '시스템');
    assert.deepEqual(a.params.messages, [...history, { role: 'user', content: '홍길동 찾아줘' }]);
    assert.deepEqual(a.params.cache_control, { type: 'ephemeral' });
    assert.deepEqual(a.params.output_config, { effort: 'low' });
    assert.equal('temperature' in a.params, false);
    assert.equal('thinking' in a.params, false);
    assert.equal(a.opts.maxRetries, 0);
    assert.ok(a.params.tools.every((t) => t.input_schema && t.input_schema.type === 'object'));
    // The assistant turn goes back unchanged (thinking block included), then all results in one user message.
    assert.deepEqual(b.params.messages.at(-2), { role: 'assistant', content: [thinking, toolUse('t1', 'search_students', { query: '홍길동' }), toolUse('t2', 'get_scores', { student_id: 'STU-9999' })] });
    assert.deepEqual(b.params.messages.at(-1), {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: '{"count":1}' },
        { type: 'tool_result', tool_use_id: 't2', content: '{"error":"없음"}', is_error: true }
      ]
    });
  });

  it('shows a notice on refusal or a cut-off reply instead of running tools', async () => {
    const refused = fakeClient([{ stop_reason: 'refusal', content: [] }]);
    const a = await createAnthropicProvider(turn(), { client: refused }).send(30000);
    assert.match(a.text, /처리하지 않았습니다/);
    assert.deepEqual(a.toolCalls, []);
    const cut = fakeClient([{ stop_reason: 'max_tokens', content: [{ type: 'text', text: '목록:' }, toolUse('t', 'list_classes', {})] }]);
    const b = await createAnthropicProvider(turn(), { client: cut }).send(30000);
    assert.match(b.text, /^목록:\n\n답변이 길어/);
    assert.deepEqual(b.toolCalls, []);
  });

  it('maps SDK errors to Korean messages', async () => {
    const Anthropic = await sdk();
    const err = new Anthropic.RateLimitError(429, { error: { message: 'slow down' } }, 'slow down', new Headers());
    await assert.rejects(createAnthropicProvider(turn(), { client: fakeClient([err]) }).send(30000), /잠시 후/);
    assert.match(anthropicErrorMessage(new Anthropic.AuthenticationError(401, {}, 'bad key', new Headers())), /ANTHROPIC_API_KEY/);
    assert.match(anthropicErrorMessage(new Anthropic.APIConnectionError({ message: 'down' })), /연결할 수 없습니다/);
  });

  it('normalises the model ID', () => {
    assert.equal(anthropicModelId(''), 'claude-haiku-5-5');
    assert.equal(anthropicModelId('claude-sonnet-5-5'), 'claude-sonnet-5-5');
    assert.equal(anthropicModelId('anthropic/claude-haiku-5.5'), 'claude-haiku-5-5');
    assert.throws(() => anthropicModelId('google/gemini-3.7-flash'), /Claude 모델 ID/);
    assert.equal(anthropicToolDefinitions().length, assistantTools().length);
  });

  it('runs a whole turn on the Anthropic API with AGENT_MODEL', async () => {
    const { run } = setup();
    const client = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: '네' }] }]);
    const out = await withEnv({ AGENT_MODEL: 'anthropic/claude-sonnet-5.5' }, () =>
      runAgentTurn({ message: '안녕' }, run, { provider: 'anthropic', client }));
    assert.equal(out.message.content, '네');
    assert.equal(client.requests[0].params.model, 'claude-sonnet-5-5');
    assert.match(client.requests[0].params.system, /오늘: 2026-09-14/);
  });

  it('picks the provider from ANTHROPIC_API_KEY', () => {
    withEnv({ ANTHROPIC_API_KEY: 'sk-ant-test', AI_API_KEY: undefined, OPENAI_API_KEY: undefined }, () => {
      assert.equal(getAgentProvider(), 'anthropic');
      assert.equal(isAgentConfigured(), true);
    });
    withEnv({ ANTHROPIC_API_KEY: undefined, AI_API_KEY: 'k' }, () => {
      assert.equal(getAgentProvider(), 'openrouter');
      assert.equal(isAgentConfigured(), true);
    });
    withEnv({ ANTHROPIC_API_KEY: '  ', AI_API_KEY: undefined, OPENAI_API_KEY: undefined }, () => {
      assert.equal(isAgentConfigured(), false);
    });
  });

  it('streams text deltas only when given onText', async () => {
    const client = fakeClient([
      { stop_reason: 'tool_use', content: [{ type: 'text', text: '찾아볼게요.' }, toolUse('t1', 'search_students', { query: '홍길동' })] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '홍길동 학생을 찾았습니다.' }], pieces: ['홍길동 학생을 ', '찾았습니다.'] }
    ]);
    const provider = createAnthropicProvider(turn('홍길동 찾아줘'), { client });
    const deltas = [];
    const first = await provider.send(30000, { onText: (t) => deltas.push(t) });
    assert.equal(first.text, '찾아볼게요.');
    assert.deepEqual(first.toolCalls.map((c) => c.id), ['t1']);
    provider.addToolResults([{ id: 't1', content: '{}', isError: false }]);
    const second = await provider.send(30000, { onText: (t) => deltas.push(t) });
    assert.deepEqual(deltas, ['찾아볼게요.', '홍길동 학생을 ', '찾았습니다.']);
    assert.equal(second.text, '홍길동 학생을 찾았습니다.');
    assert.deepEqual(client.requests.map((r) => r.streamed), [true, true]);
    assert.ok(client.requests[0].opts.signal instanceof AbortSignal);
    assert.equal(client.requests[0].opts.maxRetries, 0);
    // The tool_use turn goes back to the model from the streamed final message.
    assert.equal(client.requests[1].params.messages.at(-2).content[1].id, 't1');

    const plain = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: '네' }] }]);
    await createAnthropicProvider(turn(), { client: plain }).send(30000);
    assert.equal(plain.requests[0].streamed, false);
  });

  it('streams a stop notice after the text', async () => {
    const client = fakeClient([{ stop_reason: 'max_tokens', content: [{ type: 'text', text: '목록:' }] }]);
    const deltas = [];
    const res = await createAnthropicProvider(turn(), { client }).send(30000, { onText: (t) => deltas.push(t) });
    assert.equal(deltas.join(''), res.text);
  });

  it('stops on abort while streaming, and sends nothing when already stopped', async () => {
    const Anthropic = await sdk();
    const controller = new AbortController();
    const client = fakeClient([(params, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Anthropic.APIUserAbortError()));
      controller.abort();
    })]);
    await assert.rejects(createAnthropicProvider(turn(), { client }).send(30000, { onText: () => {}, signal: controller.signal }),
      (e) => e.code === 'REQUEST_ABORTED');

    const idle = fakeClient([]);
    await assert.rejects(createAnthropicProvider(turn(), { client: idle }).send(30000, { signal: controller.signal }), (e) => e.code === 'REQUEST_ABORTED');
    assert.equal(idle.requests.length, 0);
  });

  it('reports a timeout when the whole reply runs past the step deadline', async () => {
    const client = fakeClient([(params, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('Request was aborted.')));
    })]);
    const provider = createAnthropicProvider(turn(), { client });
    await assert.rejects(provider.send(20, { onText: () => {} }), /너무 오래/);
  });
});
