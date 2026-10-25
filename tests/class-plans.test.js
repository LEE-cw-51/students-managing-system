'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo, emptyTables } = require('./memory-store.js');

// Class meets 월/수. Today is Mon 2026-09-14 and the demo has a lesson recorded that day,
// so September's plannable dates are 16, 21, 23, 28, 30.
const CURRICULUM = [
  { title: '삼각형의 성질', sessions: 2, textbook: '개념원리' },
  { title: '사각형의 성질', sessions: 3 },
  { title: '도형의 닮음', sessions: 2 }
];

function setup(options) {
  const store = createMemoryStore(options);
  const api = LMS.createService(store);
  const demo = seedDemo(api);
  const cls = api.updateClass(Object.assign({}, demo.class, { curriculum: CURRICULUM }));
  return { store, api, demo, cls };
}

function itemsByKey(board) {
  const out = {};
  board.draft.items.forEach((it) => { out[it.key] = it; });
  return out;
}

function confirmAll(api, board) {
  return api.applyPlanDraft({
    draft_id: board.draft.draft_id,
    seen_version: board.base_version,
    keys: board.draft.items.filter((it) => it.selected).map((it) => it.key)
  });
}

describe('curriculum', () => {
  it('assigns stable unit ids and never reuses a deleted one', () => {
    const { api, cls } = setup();
    const ids = cls.curriculum.map((u) => u.unit_id);
    assert.deepEqual(ids, ['UNT_000001', 'UNT_000002', 'UNT_000003']);
    const renamed = api.updateClass(Object.assign({}, cls, { curriculum: [Object.assign({}, cls.curriculum[1], { title: '사각형' }), cls.curriculum[0]] }));
    assert.deepEqual(renamed.curriculum.map((u) => u.unit_id), [ids[1], ids[0]], 'rename and reorder keep ids');
    const added = api.updateClass(Object.assign({}, renamed, { curriculum: renamed.curriculum.concat([{ title: '새 단원', sessions: 1 }]) }));
    assert.equal(added.curriculum[2].unit_id, 'UNT_000004', 'the deleted unit id is not reused');
  });

  it('rejects bad session counts', () => {
    const { api, cls } = setup();
    assert.throws(() => api.updateClass(Object.assign({}, cls, { curriculum: [{ title: 'x', sessions: 0 }] })), /1~20/);
    assert.throws(() => api.updateClass(Object.assign({}, cls, { curriculum: [{ title: 'x', sessions: 1.5 }] })), /1~20/);
  });
});

describe('single-day cancellation', () => {
  it('cancels a meeting day everywhere and can be restored', () => {
    const { api, cls } = setup();
    const res = api.cancelClassDate({ class_id: cls.class_id, date: '2026-09-21', reason: '추석' });
    assert.equal(res.date, '2026-09-21');
    const row = api.getClass(cls.class_id);
    assert.equal(LMS.classMeetsOnDate(row, '2026-09-21', []), false);
    // Homework checked on the 23rd comes from the 16th, skipping the cancelled day.
    assert.equal(LMS.previousMeetingDateFor(row, '2026-09-23', []), '2026-09-16');
    const session = api.getTodayClassSession('2026-09-21', cls.class_id);
    assert.equal(session.meets, false);
    assert.deepEqual(session.cancellation, { date: '2026-09-21', reason: '추석' });
    assert.throws(() => api.cancelClassDate({ class_id: cls.class_id, date: '2026-09-21' }), /이미 휴강/);
    api.restoreClassDate({ class_id: cls.class_id, date: '2026-09-21' });
    assert.equal(LMS.classMeetsOnDate(api.getClass(cls.class_id), '2026-09-21', []), true);
  });

  it('refuses recorded days and days the class does not meet', () => {
    const { api, cls } = setup();
    assert.throws(() => api.cancelClassDate({ class_id: cls.class_id, date: '2026-09-14' }), /수업 기록이 있는/);
    assert.throws(() => api.cancelClassDate({ class_id: cls.class_id, date: '2026-09-15' }), /수업일이 아닙니다/);
    assert.throws(() => api.restoreClassDate({ class_id: cls.class_id, date: '2026-09-16' }), /휴강으로 지정된 날이 아닙니다/);
  });

  it('shows cancelled classes on the today board instead of a lesson card', () => {
    const { api, cls } = setup();
    api.cancelClassDate({ class_id: cls.class_id, date: '2026-09-16', reason: '학교 행사' });
    const board = api.getTodayBoard('2026-09-16');
    assert.equal(board.classes.length, 0);
    assert.deepEqual(board.cancelled.map((c) => [c.class_id, c.reason]), [[cls.class_id, '학교 행사']]);
  });
});

describe('basic split', () => {
  it('lays units on the remaining meeting days and summarizes weeks from them', () => {
    const { api, cls } = setup();
    const board = api.createSplitDraft(cls.class_id, '2026-09');
    const items = itemsByKey(board);
    assert.equal(items['일간|2026-09-16'].proposed.title, '삼각형의 성질 (1/2)');
    assert.equal(items['일간|2026-09-21'].proposed.title, '삼각형의 성질 (2/2)');
    assert.equal(items['일간|2026-09-30'].proposed.title, '사각형의 성질 (3/3)');
    assert.equal(items['일간|2026-09-14'], undefined, 'recorded day is not planned');
    assert.deepEqual(board.draft.carry_over, ['도형의 닮음']);
    assert.equal(items['주간|2026-09-14'], undefined, 'weeks are not planned separately');
    assert.equal(items['월간|2026-09'].proposed.title, '삼각형의 성질 ~ 사각형의 성질');
    const applied = confirmAll(api, board);
    assert.equal(applied.applied_count, 6, '1 month + 5 days');
    assert.equal(applied.weeks.find((w) => w.week_start === '2026-09-21').summary, '삼각형의 성질 · 사각형의 성질');
    assert.equal(api.getClassOverview(cls.class_id).plans.week.title, '삼각형의 성질 (1/2)');
    assert.equal(api.getClassOverview(cls.class_id).current_unit.title, '삼각형의 성질');
    assert.equal(applied.draft, null);
    assert.equal(applied.days.find((d) => d.date === '2026-09-16').plan.source, 'split');
    // Other screens read confirmed plans as before.
    assert.equal(api.getTodayClassSession('2026-09-16', cls.class_id).daily_plan.unit_titles[0], '삼각형의 성질');
  });

  it('re-plans around a cancellation and only offers to remove the stranded plan', () => {
    const { api, cls } = setup();
    confirmAll(api, api.createSplitDraft(cls.class_id, '2026-09'));
    api.cancelClassDate({ class_id: cls.class_id, date: '2026-09-21' });
    const board = api.createSplitDraft(cls.class_id, '2026-09');
    const items = itemsByKey(board);
    assert.equal(items['일간|2026-09-21'].action, 'remove');
    assert.equal(items['일간|2026-09-21'].selected, false, 'never deleted by default');
    assert.equal(items['일간|2026-09-23'].proposed.title, '삼각형의 성질 (2/2)');
    assert.equal(items['일간|2026-09-23'].selected, true, 'machine plans are replaced by default');
    assert.ok(board.warnings.some((w) => w.code === 'plan_on_off_day'));
  });

  it('keeps hand-written plans by default and never touches past or recorded days', () => {
    const { api, cls } = setup();
    api.saveClassPlan({ class_id: cls.class_id, period_type: '일간', period_key: '2026-09-14', title: '지난 수업' });
    api.saveClassPlan({ class_id: cls.class_id, period_type: '일간', period_key: '2026-09-16', title: '직접 쓴 계획' });
    const board = api.createSplitDraft(cls.class_id, '2026-09');
    const items = itemsByKey(board);
    assert.equal(items['일간|2026-09-16'].action, 'change');
    assert.equal(items['일간|2026-09-16'].selected, false);
    assert.equal(items['일간|2026-09-14'], undefined);
    assert.throws(() => api.applyPlanDraft({ draft_id: board.draft.draft_id, seen_version: board.base_version, keys: ['일간|2026-09-14'] }), /확정할 수 있는 항목이 없습니다/);
  });

  it('pushes unfinished units forward using the done status from the lesson recorder', () => {
    const { store, api, demo, cls } = setup();
    confirmAll(api, api.createSplitDraft(cls.class_id, '2026-09'));
    api.saveTodaySession({
      lesson_date: '2026-09-16', class_id: cls.class_id, session: { progress: '삼각형 절반' },
      students: demo.students.map((s) => ({ student_id: s.student_id, attendance: '출석' })),
      plan_done_status: '일부'
    });
    store.today = () => '2026-09-17';
    const board = api.createSplitDraft(cls.class_id, '2026-09');
    const items = itemsByKey(board);
    assert.equal(items['일간|2026-09-21'].proposed.title, '삼각형의 성질 (1/2)');
    assert.equal(items['일간|2026-09-23'].proposed.title, '삼각형의 성질 (2/2)');
    assert.equal(board.days.find((d) => d.date === '2026-09-16').plan.done_status, '일부');
    assert.ok(board.warnings.some((w) => w.code === 'behind'));
  });

  it('refuses to confirm when plans changed after the teacher looked', () => {
    const { api, cls } = setup();
    const board = api.createSplitDraft(cls.class_id, '2026-09');
    api.saveClassPlan({ class_id: cls.class_id, period_type: '일간', period_key: '2026-09-28', title: '끼어든 수정' });
    assert.throws(() => confirmAll(api, board), /계획이 바뀌었습니다/);
    const fresh = api.getPlanBoard(cls.class_id, '2026-09');
    assert.equal(fresh.draft.stale, true);
    assert.equal(confirmAll(api, fresh).applied_count > 0, true);
  });

  it('does not plan exam-prep classes or classes without a curriculum', () => {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    const demo = seedDemo(api);
    assert.throws(() => api.createSplitDraft(demo.class.class_id, '2026-09'), /단원 목록/);
    assert.equal(api.getPlanBoard(demo.class.class_id, '2026-09').support.ok, false);
  });
});

describe('AI draft validation', () => {
  it('drops invented dates, units and students, and fills gaps from the split', () => {
    const { api, demo, cls } = setup();
    const board = api.saveAiPlanDraft(cls.class_id, '2026-09', {
      month: { title: '삼각형과 사각형', objectives: '성질 이해' },
      days: [
        { date: '2026-09-15', title: '수업 없는 날', unit_ids: ['UNT_000001'] },
        { date: '2026-09-16', title: '이등변삼각형', unit_ids: ['UNT_000001', 'U99'], homework: 'p.10-12' },
        { date: '2026-09-16', title: '중복' }
      ],
      students: [
        { student_id: demo.students[0].student_id, kind: '보충과제', title: '오답 노트', reason: '숙제 C 연속' },
        { student_id: 'STU_999999', kind: '상담', title: '없는 학생' },
        { student_id: demo.students[1].student_id, kind: '아무거나', title: '형식 오류' }
      ],
      rationale: '시험 대비'
    }, { model: 'test-model' });
    const items = itemsByKey(board);
    assert.equal(items['일간|2026-09-16'].proposed.title, '이등변삼각형');
    assert.deepEqual(items['일간|2026-09-16'].proposed.unit_ids, ['UNT_000001']);
    assert.equal(items['일간|2026-09-21'].proposed.title, '삼각형의 성질 (2/2)', 'missing day filled by split');
    assert.equal(items['월간|2026-09'].proposed.title, '삼각형과 사각형');
    assert.equal(board.draft.mode, 'ai');
    assert.equal(board.draft.rationale, '시험 대비');
    assert.equal(board.draft.warnings.length, 3);
    assert.deepEqual(board.draft.students.map((s) => s.title), ['오답 노트']);
  });

  it('sends aliases instead of names in the AI context', () => {
    const { api, demo, cls } = setup();
    const ctx = api.getClassPlanContext(cls.class_id, '2026-09');
    const text = JSON.stringify(ctx.input);
    demo.students.forEach((s) => assert.equal(text.includes(s.name), false));
    assert.equal(text.includes('010-'), false);
    assert.deepEqual(Object.keys(ctx.aliases), ['S1', 'S2', 'S3']);
    assert.deepEqual(ctx.input.plannable_dates.map((d) => d.date), ['2026-09-16', '2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30']);
  });

  it('extracts JSON from fenced or chatty replies', () => {
    assert.deepEqual(LMS.extractJsonObject('설명입니다\n```json\n{"a": {"b": "}"}}\n```'), { a: { b: '}' } });
    assert.equal(LMS.extractJsonObject('{"a": 1'), null);
    assert.deepEqual(LMS.extractJsonObject('{bad} {"ok": true}'), { ok: true });
  });
});

describe('edit the draft, then confirm', () => {
  function aiDraft(api, demo, cls) {
    return api.saveAiPlanDraft(cls.class_id, '2026-09', {
      days: [{ date: '2026-09-16', title: 'AI 계획', unit_ids: ['UNT_000001'] }],
      students: [
        { student_id: demo.students[1].student_id, kind: '상담', title: '학습 습관 상담', reason: '결석 2회' },
        { student_id: demo.students[2].student_id, kind: '보강', title: '결석분 보충', reason: '' }
      ]
    }, {});
  }

  it('stores edited items as the teacher\'s own plans and confirmed suggestions as tasks', () => {
    const { store, api, demo, cls } = setup();
    let board = aiDraft(api, demo, cls);
    board = api.updatePlanDraftItem({
      draft_id: board.draft.draft_id, key: '일간|2026-09-16',
      fields: { title: '내가 고친 계획', homework: 'p.20', unit_ids: ['UNT_000001', 'U99'] }
    });
    const edited = itemsByKey(board)['일간|2026-09-16'];
    assert.equal(edited.edited, true);
    assert.equal(edited.selected, true);
    assert.deepEqual(edited.proposed.unit_ids, ['UNT_000001'], 'unknown unit dropped');
    board = api.updatePlanDraftItem({ draft_id: board.draft.draft_id, key: 'student|0', fields: { kind: '클리닉', title: '클리닉 1회', reason: '결석' } });
    assert.equal(board.draft.students[0].kind, '클리닉');
    const applied = api.applyPlanDraft({
      draft_id: board.draft.draft_id, seen_version: board.base_version,
      keys: board.draft.items.filter((it) => it.selected).map((it) => it.key),
      student_keys: ['student|0', 'student|1']
    });
    assert.equal(applied.task_count, 2);
    const day = applied.days.find((d) => d.date === '2026-09-16').plan;
    assert.equal(day.title, '내가 고친 계획');
    assert.equal(day.source, 'manual');
    assert.equal(applied.days.find((d) => d.date === '2026-09-21').plan.source, 'ai');
    const tasks = store.readTable('Tasks');
    assert.deepEqual(tasks.map((t) => t.title), ['[클리닉] 클리닉 1회', '보강 일정 잡기: 결석분 보충']);
    assert.equal(tasks[0].due_date, '2026-09-16', 'next meeting day');
    assert.throws(() => api.applyPlanDraft({ draft_id: board.draft.draft_id, seen_version: applied.base_version, keys: ['일간|2026-09-21'] }), /이미 처리된 초안/);
    // The next draft keeps the teacher's version unless they pick the new one.
    const next = itemsByKey(api.createSplitDraft(cls.class_id, '2026-09'));
    assert.equal(next['일간|2026-09-16'].action, 'change');
    assert.equal(next['일간|2026-09-16'].selected, false);
  });

  it('refuses edits to locked days, missing items and finished drafts', () => {
    const { store, api, demo, cls } = setup();
    const board = aiDraft(api, demo, cls);
    assert.throws(() => api.updatePlanDraftItem({ draft_id: board.draft.draft_id, key: '일간|2026-09-14', fields: { title: 'x' } }), /찾을 수 없습니다/);
    store.today = () => '2026-09-17';
    assert.throws(() => api.updatePlanDraftItem({ draft_id: board.draft.draft_id, key: '일간|2026-09-16', fields: { title: 'x' } }), /지난 수업/);
    assert.throws(() => api.updatePlanDraftItem({ draft_id: board.draft.draft_id, key: 'student|0', fields: { title: 'x', kind: '아무거나' } }), /제안 종류/);
    api.discardPlanDraft(board.draft.draft_id);
    assert.throws(() => api.updatePlanDraftItem({ draft_id: board.draft.draft_id, key: 'student|0', fields: { title: 'x' } }), /이미 처리된 초안/);
  });

  it('drops suggestions with a discarded draft and prunes old finished drafts', () => {
    const { store, api, demo, cls } = setup();
    const board = aiDraft(api, demo, cls);
    api.discardPlanDraft(board.draft.draft_id);
    assert.equal(api.getPlanBoard(cls.class_id, '2026-09').draft, null);
    assert.equal(store.readTable('Tasks').length, 0);
    store.today = () => '2026-11-01';
    store.now = () => '2026-11-01T10:00:00';
    api.createSplitDraft(cls.class_id, '2026-11');
    assert.deepEqual(store.readTable('PlanDrafts').map((d) => d.month), ['2026-11'], 'September drafts older than 30 days are gone');
  });

  it('re-splits onto a class makeup day after a cancellation', () => {
    const { api, cls } = setup();
    confirmAll(api, api.createSplitDraft(cls.class_id, '2026-09'));
    api.cancelClassDate({ class_id: cls.class_id, date: '2026-09-21' });
    api.saveMakeupSession({ makeup_date: '2026-09-22', kind: '반', class_id: cls.class_id, start_time: '18:00', end_time: '20:00' });
    const items = itemsByKey(api.createSplitDraft(cls.class_id, '2026-09'));
    assert.equal(items['일간|2026-09-22'].proposed.title, '삼각형의 성질 (2/2)');
    assert.equal(items['일간|2026-09-21'].action, 'remove');
  });
});

describe('schema migration v3', () => {
  it('marks existing plans as hand-written and is idempotent', () => {
    const store = createMemoryStore();
    const tables = emptyTables();
    tables._Meta = tables._Meta.concat([{ prefix: LMS.SCHEMA_META_KEY, next_seq: 2 }]);
    tables.ClassPlans = [{ plan_id: 'PLN_000001', class_id: 'CLS_000001', period_type: '주간', period_key: '2026-09-14', title: '옛 계획' }];
    Object.keys(tables).forEach((name) => store.writeTable(name, tables[name]));
    assert.equal(LMS.createService(store).ensureSchema(), true);
    assert.equal(store.readTable('ClassPlans')[0].source, 'manual');
    assert.deepEqual(store.readTable('ClassPlans')[0].unit_ids, []);
    assert.equal(LMS.createService(store).ensureSchema(), false);
  });
});

describe('plan AI client', () => {
  const { requestPlanAi, mapStudentRefs } = require('../lib/plan-ai.js');
  const config = { key: 'k', baseUrl: 'https://ai.test/v1', model: 'm' };
  const reply = (content, status = 200) => ({
    ok: status < 400, status, json: async () => (status < 400 ? { model: 'used-model', choices: [{ message: { content } }] } : { error: { message: 'busy' } })
  });

  it('retries once when the reply is not JSON, then reads it', async () => {
    const calls = [];
    const fetch = async (url, init) => {
      calls.push(JSON.parse(init.body));
      return calls.length === 1 ? reply('계획은 이렇습니다') : reply('```json\n{"days": []}\n```');
    };
    const out = await requestPlanAi({ month: '2026-09' }, { config, fetch, minRetryMs: 0 });
    assert.deepEqual(out, { result: { days: [] }, model: 'used-model' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].messages.length, 3, 'retry asks for JSON only');
  });

  it('gives up with a clear message after a second unreadable reply', async () => {
    const fetch = async () => reply('no json');
    await assert.rejects(requestPlanAi({}, { config, fetch, minRetryMs: 0 }), /읽을 수 없습니다/);
  });

  it('turns rate limits and missing keys into teacher-facing messages', async () => {
    await assert.rejects(requestPlanAi({}, { config, fetch: async () => reply('', 429) }), /사용량/);
    await assert.rejects(requestPlanAi({}, { config: { ...config, key: '' } }), /AI_API_KEY/);
  });

  it('maps student refs back to ids and blanks unknown ones', () => {
    const out = mapStudentRefs({ students: [{ ref: 's1', kind: '상담' }, { ref: 'S9' }] }, { S1: 'STU_000001' });
    assert.deepEqual(out.students.map((s) => s.student_id), ['STU_000001', '']);
  });
});

describe('starting point', () => {
  it('starts after units marked as already finished', () => {
    const { api, cls } = setup();
    const marked = api.updateClass(Object.assign({}, cls, { curriculum: cls.curriculum.map((u, i) => Object.assign({}, u, { completed: i === 0 })) }));
    assert.equal(marked.curriculum[0].completed, true);
    const board = api.createSplitDraft(cls.class_id, '2026-09');
    assert.equal(itemsByKey(board)['일간|2026-09-16'].proposed.title, '사각형의 성질 (1/3)');
    assert.equal(board.curriculum[0].complete, true);
  });

  it('asks for a starting point when lessons exist but no unit is done', () => {
    const { store, api, cls } = setup();
    store.today = () => '2026-09-15';
    assert.ok(api.getPlanBoard(cls.class_id, '2026-09').warnings.some((w) => w.code === 'no_start'));
  });
});

describe('one draft button', () => {
  const { draftClassPlan } = require('../lib/plan-ai.js');
  const config = { key: 'k', baseUrl: 'https://ai.test/v1', model: 'm' };
  const runner = (api) => (fn) => Promise.resolve(fn(api));

  it('uses the unit-order split when there is no AI key', async () => {
    const { api, cls } = setup();
    const board = await draftClassPlan(cls.class_id, '2026-09', runner(api), { configured: false });
    assert.equal(board.draft.mode, 'split');
    assert.match(board.draft.warnings[0], /AI 키가 없어/);
  });

  it('falls back to the split with the reason when the AI call fails', async () => {
    const { api, cls } = setup();
    const fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const board = await draftClassPlan(cls.class_id, '2026-09', runner(api), { configured: true, config, fetch });
    assert.equal(board.draft.mode, 'split');
    assert.match(board.draft.warnings[0], /사용량/);
  });

  it('saves an AI draft with students mapped back from aliases', async () => {
    const { api, demo, cls } = setup();
    const reply = { days: [{ date: '2026-09-16', title: 'AI 계획', unit_ids: ['UNT_000001'] }], students: [{ ref: 'S1', kind: '상담', title: '면담' }] };
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({ model: 'mock', choices: [{ message: { content: JSON.stringify(reply) } }] }) });
    const board = await draftClassPlan(cls.class_id, '2026-09', runner(api), { configured: true, config, fetch });
    assert.equal(board.draft.mode, 'ai');
    assert.equal(board.draft.model, 'mock');
    const sorted = demo.students.map((s) => s.student_id).sort();
    assert.equal(board.draft.students[0].student_id, sorted[0]);
  });

  it('still reports class problems instead of hiding them behind the split', async () => {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    const demo = seedDemo(api);
    await assert.rejects(draftClassPlan(demo.class.class_id, '2026-09', runner(api), { configured: true, config }), /단원 목록/);
  });
});

describe('shared AI client', () => {
  it('runs the monthly report sections through the same client', async () => {
    const { buildMonthlyAiSections } = require('../lib/monthly-ai.js');
    let sent;
    const fetch = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '【학습 분석】\n좋음' } }] }) }; };
    const out = await buildMonthlyAiSections({ student: { name: '가' } }, { config: { key: 'k', baseUrl: 'https://ai.test/v1', model: 'm' }, fetch });
    assert.equal(out.text, '【학습 분석】\n좋음');
    assert.equal(sent.temperature, 0.4);
  });

  it('keeps internal service functions off the browser API', () => {
    const { isPublicApi } = require('../lib/store.js');
    const api = LMS.createService(createMemoryStore());
    assert.equal(isPublicApi(api, 'getPlanBoard'), true);
    ['saveAiPlanDraft', 'getClassPlanContext', 'createSplitDraft', 'setDailyPlanDone', 'ensureSchema', 'nope'].forEach((n) => {
      assert.equal(isPublicApi(api, n), false, n);
    });
  });
});
