'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore } = require('./memory-store.js');

const TODAY = '2026-10-26';

// A반 and B반 are suspended 11-02 ~ 11-30 for 대비반 (가 from A반, 나 from B반); C반 is a mistake with 다 only.
function setup() {
  const store = createMemoryStore({ today: TODAY, now: TODAY + 'T09:00:00' });
  const api = LMS.createService(store);
  api.ensureSchema();
  const mk = (name, weekday) => api.createClass({ school_year: '2026', semester: '2', grade: '중2', class_name: name, weekday, start_time: '18:00', end_time: '20:00', status: '운영' });
  const a = mk('A반', '월/수').class_id;
  const b = mk('B반', '화/목').class_id;
  const c = mk('C반', '금').class_id;
  const st = (name, classId) => api.createStudent({ name, grade: '중2', school: '한빛중', enrollment_date: '2026-09-01', status: '재원', class_id: classId });
  const ga = st('가', a);
  const na = st('나', b);
  const da = st('다', c);
  const period = api.saveExamPeriod({ title: '기말', start_date: '2026-11-02', end_date: '2026-11-30' });
  const res = api.applyExamGroups(period.exam_period_id, {
    groups: [{ class_name: '대비반', schedule: [{ day: '금', start: '18:00', end: '20:00' }], students: [
      { student_id: ga.student_id, source_class_id: a, end_date: '2026-11-10' },
      { student_id: na.student_id, source_class_id: b, end_date: '2026-11-20' }
    ] }],
    suspended_class_ids: [a, b, c]
  });
  const id = period.exam_period_id;
  const periodRow = () => LMS.findById(store.readTable('ExamPeriods'), 'exam_period_id', id);
  return { store, api, a, b, c, ga, na, da, id, periodRow, examClass: res.classes[0].class_id };
}

function seedRelated(store, classId) {
  const add = (name, row) => store.writeTable(name, store.readTable(name).concat([row]));
  add('ClassSessions', { session_id: 'SES-X', lesson_date: '2026-10-30', class_id: classId, progress: '1단원' });
  add('ClassSessionNotices', { id: 'CSN-X', lesson_date: '2026-10-30', class_id: classId, class_notice: '공지' });
  add('HomeworkItems', { item_id: 'HWI-X', lesson_date: '2026-10-30', class_id: classId, title: '프린트' });
  add('ClassPlans', { plan_id: 'PLN-X', class_id: classId, period_type: '일간', period_key: '2026-10-30', title: '계획' });
  add('PlanDrafts', { draft_id: 'PDR-X', class_id: classId, month: '2026-11', status: '초안' });
  add('MakeupSessions', { makeup_id: 'MKS-X', makeup_date: '2026-10-31', class_id: classId, title: '보강' });
  add('Tasks', { task_id: 'TSK-X', due_date: '2026-10-31', title: '할 일', class_id: classId, status: '대기' });
  return LMS.createService(store);
}

describe('deleting a class', () => {
  it('deletes a class without records with its rows, and takes it off suspension lists', () => {
    const t = setup();
    t.api = seedRelated(t.store, t.c);
    assert.equal(t.api.getClassOverview(t.c).has_lessons, false);
    assert.equal(t.api.deleteClass(t.c), true);
    assert.ok(!t.store.readTable('Classes').some((r) => r.class_id === t.c));
    assert.ok(!t.store.readTable('StudentClasses').some((r) => r.class_id === t.c));
    ['ClassSessions', 'ClassSessionNotices', 'HomeworkItems', 'ClassPlans', 'PlanDrafts', 'MakeupSessions'].forEach((name) => {
      assert.ok(!t.store.readTable(name).some((r) => r.class_id === t.c), name);
    });
    const task = t.store.readTable('Tasks').find((r) => r.task_id === 'TSK-X');
    assert.equal(task.class_id, '', 'task kept without its class');
    assert.deepEqual(LMS.suspendedClassIds(t.periodRow()), [t.a, t.b]);
    assert.ok(!(t.c in t.periodRow().class_resume_dates));
    assert.equal(t.api.getStudent(t.da.student_id).class_history.length, 0);
  });

  it('refuses a class with lessons or homework checks', () => {
    const t = setup();
    t.api.saveLessonsBatch([{ lesson_date: '2026-10-30', class_id: t.c, student_id: t.da.student_id, attendance: '출석' }]);
    assert.equal(t.api.getClassOverview(t.c).has_lessons, true);
    assert.throws(() => t.api.deleteClass(t.c), /수업 기록이 있는 반은 삭제할 수 없습니다/);

    const t2 = setup();
    t2.store.writeTable('HomeworkChecks', [{ check_id: 'HWC-X', item_id: 'HWI-X', student_id: t2.da.student_id, status: '완료' }]);
    t2.api = seedRelated(t2.store, t2.c);
    assert.equal(t2.api.getClassOverview(t2.c).has_lessons, true);
    assert.throws(() => t2.api.deleteClass(t2.c), /수업 기록이 있는 반은 삭제할 수 없습니다/);
    assert.ok(t2.store.readTable('Classes').some((r) => r.class_id === t2.c));
  });

  it('refuses a regular class used as the source of an exam-prep placement', () => {
    const t = setup();
    assert.throws(() => t.api.deleteClass(t.a), /원래 반/);
    assert.ok(t.store.readTable('Classes').some((r) => r.class_id === t.a));
  });

  it('deletes an exam-prep class and recomputes resume dates', () => {
    const t = setup();
    assert.equal(t.periodRow().class_resume_dates[t.a], '2026-11-10');
    t.api.deleteClass(t.examClass);
    assert.ok(!t.store.readTable('StudentClasses').some((r) => r.status === '임시'));
    assert.equal(t.periodRow().class_resume_dates[t.a], '2026-11-30', 'no moved students → period end');
    t.api.deleteClass(t.a);
    assert.deepEqual(LMS.suspendedClassIds(t.periodRow()), [t.b, t.c]);
  });
});
