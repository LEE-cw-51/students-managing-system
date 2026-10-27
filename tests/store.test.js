'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');

function metaSeq(store, prefix) {
  return store.readTable('_Meta').find((r) => r.prefix === prefix).next_seq;
}

const CLASS = {
  school_year: '2026', semester: '2', grade: '중2', class_name: '중2 B반',
  weekday: '화', start_time: '18:00', end_time: '20:00', status: '운영'
};

describe('store transactions', () => {
  it('a failed service call leaves no partial rows, ids or cached values', () => {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    seedDemo(api);
    const students = store.readTable('Students').length;
    const seq = metaSeq(store, 'STU');
    assert.throws(() => api.createStudent({
      name: '박민수', grade: '중2', status: '재원', enrollment_date: '2026-03-01', class_id: 'CLS_999999'
    }), /반 정보를 찾을 수 없습니다/);
    assert.equal(store.readTable('Students').length, students);
    assert.equal(metaSeq(store, 'STU'), seq);
    assert.equal(api.getStudents({}).length, students, 'service cache dropped');
    const next = api.createStudent({ name: '박민수', grade: '중2', status: '재원', enrollment_date: '2026-03-01' });
    assert.equal(next.student_id, LMS.formatId('STU', seq), 'id not burned');
  });

  it('a draft item edit that fails validation keeps the old title', () => {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    const demo = seedDemo(api);
    const cls = demo.class;
    const board = api.saveAiPlanDraft(cls.class_id, '2026-09', {
      days: [],
      students: [{ student_id: demo.students[1].student_id, kind: '상담', title: '학습 습관 상담', reason: '' }]
    }, {});
    assert.throws(() => api.updatePlanDraftItem({
      draft_id: board.draft.draft_id, key: 'student|0', fields: { title: '바뀐 제목', kind: '아무거나' }
    }), /제안 종류/);
    const draft = store.readTable('PlanDrafts').find((d) => d.draft_id === board.draft.draft_id);
    assert.equal(JSON.stringify(draft).indexOf('바뀐 제목'), -1);
    assert.equal(api.getPlanBoard(cls.class_id, '2026-09').draft.students[0].title, '학습 습관 상담');
  });

  it('nested values read from the store are copies', () => {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    const cls = api.createClass(CLASS);
    const rows = store.readTable('Classes');
    rows[0].schedule[0].day = '토';
    assert.equal(store.readTable('Classes')[0].schedule[0].day, '화');
    assert.equal(LMS.createService(store).getClass(cls.class_id).schedule[0].day, '화');
  });

  it('only the outermost call is a unit', () => {
    const store = createMemoryStore();
    const api = LMS.createService(store);
    assert.throws(() => store.transaction(() => {
      api.createClass(CLASS);
      throw new Error('중단');
    }), /중단/);
    assert.equal(store.readTable('Classes').length, 0, 'outer failure undoes inner successes');

    store.transaction(() => {
      api.createClass(CLASS);
      assert.throws(() => api.createStudent({ name: '가', grade: '중2', status: '재원', class_id: 'CLS_999999' }));
    });
    assert.equal(store.readTable('Classes').length, 1, 'a caught inner failure does not undo the outer call');
  });

  it('the file store writes the file once per successful call and never for a failed one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-store-'));
    const file = path.join(dir, 'data.json');
    let writes = 0;
    const countingFs = Object.assign({}, fs, {
      writeFileSync(...args) { writes++; return fs.writeFileSync(...args); }
    });
    try {
      const store = createMemoryStore({ fs: countingFs, file });
      const api = LMS.createService(store);
      api.createClass(CLASS);
      assert.equal(writes, 1);
      const saved = fs.readFileSync(file, 'utf8');
      assert.throws(() => api.createStudent({ name: '가', grade: '중2', status: '재원', class_id: 'CLS_999999' }));
      assert.equal(writes, 1);
      assert.equal(fs.readFileSync(file, 'utf8'), saved);
      api.getClasses({});
      assert.equal(writes, 1, 'reads do not write');
      assert.equal(createMemoryStore({ fs, file }).readTable('Classes').length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
