'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Workspace data and accounts live under dev-server/ with the file store: keep them in a temp folder.
// Must run before lib/store.js is loaded.
const originalCwd = process.cwd();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-workspaces-'));
process.chdir(dataDir);
process.env.LMS_STORE = 'file';
process.env.AUTH_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
delete process.env.AI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const stubs = require('./next-stubs.js');
stubs.install();

const { withService, serviceRunner, DEFAULT_WORKSPACE_ID } = require('../lib/store.js');
const { bootstrapAdmin, createInvite, acceptInvite, setUserDisabled } = require('../lib/accounts.js');
const { SESSION_COOKIE, serviceFor } = require('../lib/auth.js');
const { sign } = require('../lib/signing.js');
const { APP_SESSION, MCP_CONNECTOR, propose, apply, reject } = require('../lib/proposals.js');
const { readWriteMode } = require('../lib/write-policy.js');

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const ORIGIN = 'https://lms.test';
const STUDENT = { grade: '중2', parent_phone: '010-0000-0000', enrollment_date: '2026-03-01', status: '재원' };
const sessionOf = ({ user, workspaceId }) => ({ uid: user.id, wid: workspaceId, ver: user.session_version, email: user.email });

async function newTeacher(email) {
  const { token } = await createInvite({ email });
  return sessionOf(await acceptInvite(token, { password: 'teacher-pass-1' }));
}

function signIn(session, extra = {}) {
  stubs.jar.clear();
  if (session) stubs.jar.set(SESSION_COOKIE, sign({ uid: session.uid, wid: session.wid, ver: session.ver, at: Date.now(), ...extra }, 'session'));
}

function post(url, body) {
  return new Request(ORIGIN + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body)
  });
}

const dispatcherP = import('../app/api/[name]/route.js');

/** POST /api/<name> with args, as whoever signIn() set. Returns { status, body }. */
async function callApi(name, ...args) {
  const { POST } = await dispatcherP;
  const res = await POST(post(`/api/${name}`, { args }), { params: Promise.resolve({ name }) });
  return { status: res.status, body: await res.json() };
}

let admin;
let a;
let b;
let bStudent;
let bClass;

before(async () => {
  admin = sessionOf(await bootstrapAdmin({ email: 'admin@test.local', password: 'admin-pass-1' }));
  a = await newTeacher('a@test.local');
  b = await newTeacher('b@test.local');
  // Only B has a student and a class, so their ids exist in no other workspace.
  ({ bStudent, bClass } = await withService(b.wid, (api) => {
    api.saveSettings({ academy_name: 'B학원' });
    return { bStudent: api.createStudent({ ...STUDENT, name: '비밀학생' }), bClass: api.createClass({ class_name: 'B반' }) };
  }));
});

const bStudentRow = () => withService(b.wid, (api) => api.getStudent(bStudent.student_id));

describe('withService keeps workspaces apart', () => {
  it('needs a valid workspace id', async () => {
    const read = (api) => api.getStudentList({});
    for (const wid of [undefined, null, '', 'default', '../data', `${DEFAULT_WORKSPACE_ID}x`]) {
      await assert.rejects(withService(wid, read), /작업공간/, String(wid));
    }
    await assert.rejects(withService(read), /작업공간/, 'the old withService(fn) form');
    await assert.rejects(withService(DEFAULT_WORKSPACE_ID), TypeError);
    assert.throws(() => serviceRunner(undefined), /작업공간/);
    assert.throws(() => serviceFor({ uid: a.uid }), /작업공간/);
  });

  it('A cannot read or change B data', async () => {
    assert.deepEqual(await withService(a.wid, (api) => api.getStudentList({}).map((s) => s.name)), []);
    await assert.rejects(withService(a.wid, (api) => api.getStudent(bStudent.student_id)));
    await assert.rejects(withService(a.wid, (api) => api.updateStudent({ ...STUDENT, student_id: bStudent.student_id, name: '바꿈' })));
    assert.notEqual(await withService(a.wid, (api) => api.getSettings().academy_name), 'B학원');
    assert.deepEqual(await withService(DEFAULT_WORKSPACE_ID, (api) => api.getStudentList({}).filter((s) => s.name === '비밀학생')), []);
    assert.equal((await bStudentRow()).name, '비밀학생');
  });

  it('writes in A stay in A, and each workspace numbers its own ids', async () => {
    const mine = await withService(a.wid, (api) => api.createStudent({ ...STUDENT, name: 'A학생' }));
    assert.equal(mine.student_id, bStudent.student_id, 'same first id in both workspaces');
    assert.deepEqual(await withService(b.wid, (api) => api.getStudentList({}).map((s) => s.name)), ['비밀학생']);
    assert.equal(await withService(a.wid, (api) => api.getStudent(mine.student_id).name), 'A학생');
    await withService(a.wid, (api) => api.updateStudent({ ...STUDENT, student_id: mine.student_id, name: 'A학생2' }));
    assert.equal((await bStudentRow()).name, '비밀학생', 'updating the same id in A leaves B alone');
    await withService(a.wid, (api) => api.updateStudent({ ...STUDENT, student_id: mine.student_id, name: 'A학생' }));
  });
});

describe('exams, write mode, proposals and Claude connections stay in their workspace', () => {
  const EXAM = { school_year: '2026', semester: '2', exam_type: '기말', grade: '중2', school: '한빛중', exam_date: '2026-11-20' };
  let bExam;
  let bPeriod;

  before(async () => {
    ({ bExam, bPeriod } = await withService(b.wid, (api) => ({
      bExam: api.saveSchoolExam(EXAM),
      bPeriod: api.saveExamPeriod({ title: 'B 기말 대비', start_date: '2026-11-02', end_date: '2026-11-30' })
    })));
  });

  const bExams = () => withService(b.wid, (api) => api.getSchoolExams({ school_year: '2026' }).map((e) => e.school_exam_id));
  const bPeriods = () => withService(b.wid, (api) => api.getExamPeriods().map((p) => p.exam_period_id));

  it('A cannot see or delete B school exams', async () => {
    signIn(a);
    assert.deepEqual((await callApi('getSchoolExams', { school_year: '2026' })).body.data, []);
    assert.equal((await callApi('deleteSchoolExam', bExam.school_exam_id)).body.ok, false);
    assert.deepEqual(await bExams(), [bExam.school_exam_id]);
    signIn(b);
    assert.deepEqual((await callApi('getSchoolExams', { school_year: '2026' })).body.data.map((e) => e.school_exam_id), [bExam.school_exam_id]);
  });

  it('A cannot see or delete B exam periods', async () => {
    signIn(a);
    assert.deepEqual((await callApi('getExamPeriods')).body.data, []);
    assert.equal((await callApi('getExamPeriodDetail', bPeriod.exam_period_id)).body.ok, false);
    assert.equal((await callApi('deleteExamPeriod', bPeriod.exam_period_id)).body.ok, false);
    assert.deepEqual(await bPeriods(), [bPeriod.exam_period_id]);
  });

  it('each workspace has its own Claude write mode', async () => {
    await withService(b.wid, (api) => api.saveSettings({ mcp_write_mode: 'proposal' }));
    assert.equal(await readWriteMode(serviceFor(b)), 'proposal');
    assert.equal(await readWriteMode(serviceFor(a)), 'read_only');
  });

  it('a Claude proposal queued in B is only pending in B', async () => {
    const saved = await propose(MCP_CONNECTOR, {
      calls: [{ tool: 'create_task', args: { due_date: '2026-11-20', kind: 'admin', title: 'B 시험지 인쇄' } }]
    }, serviceFor(b));
    const id = saved.message.proposal.proposal_id;
    signIn(a);
    assert.deepEqual((await callApi('listPendingProposals')).body.data, []);
    const out = await apply(APP_SESSION, { proposal_ids: [id] }, serviceFor(a));
    assert.equal(out.results[0].error, '제안을 찾을 수 없습니다.');
    signIn(b);
    assert.deepEqual((await callApi('listPendingProposals')).body.data.map((p) => p.proposal_id), [id]);
    await reject(APP_SESSION, { proposal_ids: [id] }, serviceFor(b));
  });

  it('A cannot list or cut B Claude connections', async () => {
    await withService(b.wid, (api) => api.saveOAuthGrant({ grant_id: 'grant-b', exp_ms: Date.now() + 60_000 }, Date.now()));
    signIn(a);
    assert.deepEqual((await callApi('listMcpConnections')).body.data, []);
    assert.equal((await callApi('revokeMcpConnection', 'grant-b')).body.data, false);
    signIn(b);
    assert.deepEqual((await callApi('listMcpConnections')).body.data.map((c) => c.grant_id), ['grant-b']);
  });
});

describe('/api/[name] dispatcher', () => {
  it('answers 401 without a usable session', async () => {
    signIn(null);
    assert.equal((await callApi('getStudentList', {})).status, 401);
    signIn(a, { wid: b.wid });
    assert.equal((await callApi('getStudentList', {})).status, 401, 'A user with the B workspace in a forged-looking cookie');
    signIn(a, { wid: crypto.randomUUID() });
    assert.equal((await callApi('getStudentList', {})).status, 401);
    const off = await newTeacher('off@test.local');
    signIn(off);
    assert.equal((await callApi('getStudentList', {})).status, 200);
    await setUserDisabled(off.uid, true);
    assert.equal((await callApi('getStudentList', {})).status, 401);
  });

  it('a session for A sees only A data', async () => {
    signIn(a);
    const list = await callApi('getStudentList', {});
    assert.equal(list.body.ok, true);
    assert.deepEqual(list.body.data.map((s) => s.name), ['A학생']);
    const boot = await callApi('getShellBootstrap');
    assert.notEqual(boot.body.data.settings.academy_name, 'B학원');
    assert.deepEqual(boot.body.data.search.students.map((s) => s.name), ['A학생']);
    assert.equal((await callApi('getClassList', {})).body.data.some((c) => c.class_id === bClass.class_id), false);
    signIn(b);
    assert.deepEqual((await callApi('getStudentList', {})).body.data.map((s) => s.name), ['비밀학생']);
  });

  it('a session for A cannot change B data, directly or in apiBatch', async () => {
    const before = await bStudentRow();
    signIn(a);
    const classUpdate = await callApi('updateClass', { class_id: bClass.class_id, class_name: '해킹반' });
    assert.equal(classUpdate.body.ok, false);
    const batch = await callApi('apiBatch', [
      { name: 'createStudent', args: [{ ...STUDENT, name: '끼어들기' }] },
      { name: 'updateClass', args: [{ class_id: bClass.class_id, class_name: '해킹반' }] }
    ]);
    assert.equal(batch.body.ok, false);
    assert.deepEqual((await callApi('getStudentList', {})).body.data.map((s) => s.name), ['A학생'], 'the failed batch rolled back in A');
    assert.deepEqual(await bStudentRow(), before);
    assert.equal(await withService(b.wid, (api) => api.getClassList({}).find((c) => c.class_id === bClass.class_id).class_name), 'B반');
  });

  it('refuses service functions that are not public', async () => {
    signIn(a);
    for (const name of ['consumeOAuthJti', 'saveAgentTurn', 'applyAgentProposal', 'getMonthlyReportContext', 'constructor', '__proto__']) {
      const out = await callApi(name);
      assert.equal(out.body.ok, false, name);
      assert.match(out.body.error, /알 수 없는 API/, name);
    }
    const batch = await callApi('apiBatch', [{ name: 'saveAgentTurn', args: [{ message: 'x', reply: 'y' }] }]);
    assert.match(batch.body.error, /알 수 없는 API/);
  });
});

describe('agent approval routes', () => {
  const applyP = import('../app/api/agent/apply/route.js');
  const rejectP = import('../app/api/agent/reject/route.js');
  const agentP = import('../app/api/agent/route.js');
  let proposal;

  before(async () => {
    proposal = await withService(b.wid, (api) => api.saveAgentTurn({
      message: '할 일 추가',
      reply: '승인해 주세요',
      calls: [{ tool: 'create_task', args: { due_date: '2026-09-20', kind: 'admin', title: 'B 교재 주문' } }]
    }).message.proposal);
  });

  const pendingIn = (wid) => withService(wid, (api) => api.listPendingProposals().map((p) => p.proposal_id));
  const statusIn = (wid) => withService(wid, (api) => api.getAgentProposalOrder([proposal.proposal_id]).map((p) => p.status));

  it('A cannot approve or reject a B proposal', async () => {
    const apply = (await applyP).POST;
    const reject = (await rejectP).POST;
    signIn(a);
    const one = await (await apply(post('/api/agent/apply', { proposal_id: proposal.proposal_id }))).json();
    assert.equal(one.ok, false);
    const many = await (await apply(post('/api/agent/apply', { proposal_ids: [proposal.proposal_id] }))).json();
    assert.equal(many.data.results[0].error, '제안을 찾을 수 없습니다.');
    const rej = await (await reject(post('/api/agent/reject', { proposal_ids: [proposal.proposal_id] }))).json();
    assert.ok(rej.data.results[0].error, JSON.stringify(rej));
    assert.deepEqual(await pendingIn(b.wid), [proposal.proposal_id]);
    assert.deepEqual(await statusIn(b.wid), ['pending']);
    assert.deepEqual(await pendingIn(a.wid), []);
  });

  it('B can approve its own proposal', async () => {
    const apply = (await applyP).POST;
    signIn(b);
    const out = await (await apply(post('/api/agent/apply', { proposal_id: proposal.proposal_id }))).json();
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(await pendingIn(b.wid), []);
  });

  it('every agent route answers 401 without a session', async () => {
    signIn(null);
    for (const [routeP, url, body] of [[agentP, '/api/agent', { message: 'hi' }], [applyP, '/api/agent/apply', { proposal_id: 'x' }], [rejectP, '/api/agent/reject', { proposal_ids: ['x'] }]]) {
      assert.equal((await (await routeP).POST(post(url, body))).status, 401, url);
    }
  });
});

describe('monthly report PDF and class plan draft routes', () => {
  const pdfP = import('../app/api/monthly-report/pdf/route.js');
  const planP = import('../app/api/generateClassPlanAi/route.js');
  const monthlyAiP = import('../app/api/generateMonthlyReportAi/route.js');

  it('A cannot export a PDF for a B student', async () => {
    const { POST } = await pdfP;
    signIn(a);
    const res = await POST(post('/api/monthly-report/pdf', { student_id: 'STU-none', year: 2026, month: 9, report_text: '본문' }));
    assert.equal((await res.json()).ok, false);
    const cross = await POST(post('/api/monthly-report/pdf', { student_id: bStudent.student_id, year: 2026, month: 9, report_text: '본문' }));
    // A has its own student with the same id: the PDF is about A's student, never B's.
    assert.equal(cross.headers.get('Content-Type'), 'application/pdf');
    const filename = decodeURIComponent(cross.headers.get('Content-Disposition'));
    assert.match(filename, /A학생/);
    assert.doesNotMatch(filename, /비밀학생/);
  });

  it('A cannot draft a plan for a B class', async () => {
    const { POST } = await planP;
    const boardOf = () => withService(b.wid, (api) => JSON.stringify(api.getPlanBoard(bClass.class_id, '2026-09')));
    const before = await boardOf();
    signIn(a);
    const out = await (await POST(post('/api/generateClassPlanAi', { class_id: bClass.class_id, month: '2026-09' }))).json();
    assert.equal(out.ok, false);
    assert.match(out.error, /반/);
    assert.equal(await boardOf(), before);
    signIn(b);
    const own = await (await POST(post('/api/generateClassPlanAi', { class_id: bClass.class_id, month: '2026-09' }))).json();
    assert.notEqual(own.error, out.error, 'B finds its own class');
  });

  it('answer 401 without a session', async () => {
    signIn(null);
    assert.equal((await (await pdfP).POST(post('/api/monthly-report/pdf', {}))).status, 401);
    assert.equal((await (await planP).POST(post('/api/generateClassPlanAi', {}))).status, 401);
    assert.equal((await (await monthlyAiP).POST(post('/api/generateMonthlyReportAi', {}))).status, 401);
  });
});
