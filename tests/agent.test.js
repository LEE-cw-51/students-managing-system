'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');
const { AGENT_TOOLS, toolDefinitions, toolResultText, TOOL_RESULT_MAX_CHARS } = require('../lib/agent-tools.js');
const { runAgentTurn, applyProposal } = require('../lib/agent.js');
const { chatWithTools, parseToolArguments } = require('../lib/ai-client.js');

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
    AGENT_TOOLS.filter((t) => t.kind === 'read').forEach((t) => {
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

  it('every write tool has a matching approval action and no direct call', () => {
    AGENT_TOOLS.filter((t) => t.kind === 'write').forEach((t) => {
      assert.equal(typeof t.call, 'undefined', t.name);
      assert.ok(LMS.AGENT_WRITE_ACTIONS[t.name], t.name);
      assert.match(t.description, /승인 필요/);
    });
    Object.keys(LMS.AGENT_WRITE_ACTIONS).forEach((name) => {
      assert.ok(AGENT_TOOLS.some((t) => t.name === name && t.kind === 'write'), name);
    });
  });

  it('builds OpenAI-style definitions and cuts long results', () => {
    const defs = toolDefinitions();
    assert.equal(defs.length, AGENT_TOOLS.length);
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

  it('keeps unreadable arguments visible', () => {
    assert.deepEqual(parseToolArguments('{bad'), { __unreadable: '{bad' });
    assert.deepEqual(parseToolArguments(''), {});
  });
});

describe('runAgentTurn', () => {
  it('answers a question with read tools and stores the conversation', async () => {
    const { api, hong, run } = setup();
    const { fetch, requests } = scriptedFetch([
      { role: 'assistant', content: null, tool_calls: [toolCall('c1', 'search_students', { query: '홍길동' })] },
      { role: 'assistant', content: `홍길동 [[student:${hong.student_id}]] 학생을 찾았습니다.` }
    ]);
    const out = await runAgentTurn({ message: '홍길동 찾아줘' }, run, { config: CONFIG, fetch });
    assert.match(out.message.content, /찾았습니다/);
    assert.equal(out.message.proposal, null);
    assert.deepEqual(out.steps, [{ tool: 'search_students', kind: 'read', ok: true }]);
    // The second request carries the tool result back.
    const toolMsg = requests[1].messages.find((m) => m.role === 'tool');
    assert.equal(toolMsg.tool_call_id, 'c1');
    assert.match(toolMsg.content, new RegExp(hong.student_id));
    assert.match(requests[0].messages[0].content, /오늘: 2026-09-14/);

    const conv = api.getAgentConversation(out.conversation_id);
    assert.deepEqual(conv.messages.map((m) => m.role), ['user', 'assistant']);
    assert.equal(api.listAgentConversations()[0].title, '홍길동 찾아줘');
  });

  it('turns write tools into one pending proposal without changing data', async () => {
    const { api, hong, kim, lessonOf, run } = setup();
    const hongLesson = lessonOf(hong.student_id);
    const kimLesson = lessonOf(kim.student_id);
    const { fetch, requests } = scriptedFetch([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          toolCall('w1', 'update_attendance', { lesson_id: hongLesson.lesson_id, attendance: '결석' }),
          toolCall('w2', 'update_attendance', { lesson_id: kimLesson.lesson_id, attendance: '결석' }),
          toolCall('w3', 'update_attendance', { lesson_id: hongLesson.lesson_id, attendance: '결석' }),
          toolCall('w4', 'update_attendance', { lesson_id: 'LES-9999', attendance: '결석' })
        ]
      },
      { role: 'assistant', content: '두 학생 결석 처리를 승인해 주세요.' }
    ]);
    const out = await runAgentTurn({ message: '홍길동, 김철수 오늘 결석' }, run, { config: CONFIG, fetch });
    const p = out.message.proposal;
    assert.equal(p.status, 'pending');
    assert.equal(p.calls.length, 2);
    assert.equal(p.calls[0].before, '출석');
    assert.equal(p.calls[0].after, '결석');
    assert.match(p.calls[0].text, /홍길동 · 2026-09-14 중2 A반 출결: 출석 → 결석/);
    // Nothing is saved before approval.
    assert.equal(lessonOf(hong.student_id).attendance, '출석');
    const results = requests[1].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content.replace(/….*$/, '')));
    assert.match(results[2].status, /이미/);
    assert.match(results[3].error, /찾을 수 없습니다/);
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
    const first = scriptedFetch([{ role: 'assistant', content: '어느 학생인가요?' }]);
    const a = await runAgentTurn({ message: '민수 찾아줘' }, run, { config: CONFIG, fetch: first.fetch });
    const second = scriptedFetch([{ role: 'assistant', content: '알겠습니다.' }]);
    await runAgentTurn({ conversationId: a.conversation_id, message: '중2 학생이요' }, run, { config: CONFIG, fetch: second.fetch });
    const sent = second.requests[0].messages.map((m) => [m.role, m.content]);
    assert.deepEqual(sent.slice(1), [['user', '민수 찾아줘'], ['assistant', '어느 학생인가요?'], ['user', '중2 학생이요']]);
  });

  it('stops after the step limit and says so', async () => {
    const { run } = setup();
    const loop = { role: 'assistant', content: null, tool_calls: [toolCall('c', 'list_classes', {})] };
    const { fetch, requests } = scriptedFetch([loop, loop]);
    const out = await runAgentTurn({ message: '반 목록' }, run, { config: CONFIG, fetch, maxSteps: 2 });
    assert.equal(requests.length, 2);
    assert.match(out.message.content, /끝까지 처리하지 못했습니다/);
  });

  it('passes AI errors through without saving the turn', async () => {
    const { api, run } = setup();
    const { fetch } = scriptedFetch([{ status: 429 }]);
    await assert.rejects(runAgentTurn({ message: '안녕' }, run, { config: CONFIG, fetch }), /잠시 후/);
    assert.equal(api.listAgentConversations().length, 0);
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

  it('rejects once and refuses to apply a rejected proposal', () => {
    const { api, hong, lessonOf } = setup();
    const p = proposalWith(api, [{ tool: 'update_attendance', args: { lesson_id: lessonOf(hong.student_id).lesson_id, attendance: '결석' } }]);
    assert.equal(api.rejectAgentProposal(p.proposal_id).status, 'rejected');
    assert.throws(() => api.applyAgentProposal(p.proposal_id), /이미 처리된/);
    assert.equal(lessonOf(hong.student_id).attendance, '출석');
  });
});
