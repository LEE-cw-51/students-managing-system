'use strict';

const LMS = require('../src/01_Service.js');

function emptyTables() {
  const tables = {};
  Object.keys(LMS.TABLES).forEach((name) => {
    tables[name] = [];
  });
  tables.Settings = LMS.settingsToRows(LMS.DEFAULT_SETTINGS);
  tables._Meta = LMS.META_PREFIXES.map((prefix) => ({ prefix, next_seq: 1 }));
  return tables;
}

function cloneRows(rows) {
  return (rows || []).map((row) => Object.assign({}, row));
}

function createMemoryStore(options) {
  options = options || {};
  const fs = options.fs;
  const file = options.file;
  let tables = emptyTables();
  if (file && fs && fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') tables = Object.assign(emptyTables(), parsed);
    } catch (e) {
      // keep empty
    }
  }

  function persist() {
    if (file && fs) fs.writeFileSync(file, JSON.stringify(tables, null, 2));
  }

  return {
    readTable(name) {
      return cloneRows(tables[name] || []);
    },
    writeTable(name, rows) {
      tables[name] = cloneRows(rows);
      persist();
    },
    now() {
      return options.now || '2026-09-14T10:00:00';
    },
    today() {
      return options.today || '2026-09-14';
    },
    currentUserEmail() {
      return options.email || 'teacher@example.com';
    },
    withLock(fn) {
      return fn();
    },
    invalidateCache() {},
    _tables: tables,
    reset() {
      tables = emptyTables();
      persist();
    }
  };
}

function seedDemo(service) {
  const cls = service.createClass({
    school_year: '2026',
    semester: '2',
    grade: '중2',
    class_name: '중2 A반',
    teacher: '이찬우',
    weekday: '월/수',
    start_time: '18:00',
    end_time: '20:00',
    status: '운영'
  });
  const hong = service.createStudent({
    name: '홍길동',
    grade: '중2',
    parent_phone: '010-1111-2222',
    enrollment_date: '2026-03-01',
    status: '재원',
    class_id: cls.class_id
  });
  const kim = service.createStudent({
    name: '김철수',
    grade: '중2',
    parent_phone: '010-3333-4444',
    enrollment_date: '2026-03-01',
    status: '재원',
    class_id: cls.class_id
  });
  const lee = service.createStudent({
    name: '이영희',
    grade: '중2',
    parent_phone: '010-5555-6666',
    enrollment_date: '2026-03-01',
    status: '재원',
    class_id: cls.class_id
  });
  const common = {
    class_id: cls.class_id,
    lesson_date: '2026-09-14',
    attendance: '출석',
    test_difficulty: '중',
    assignment_completion: 'A',
    concentration: 'A',
    progress: '2-2: 중간고사 시험범위\n삼각형의 성질 ~ 사각형의 성질',
    homework: '사각형의 성질 오답 프린트\n심화 문항 프린트 20번까지'
  };
  service.saveLessonsBatch([
    Object.assign({}, common, {
      student_id: hong.student_id,
      test_status: '실시',
      test_score: 18,
      test_max_score: 20,
      special_note: '계산 실수가 잦음'
    }),
    Object.assign({}, common, {
      student_id: kim.student_id,
      test_status: '미실시',
      assignment_completion: 'B',
      concentration: 'B'
    }),
    Object.assign({}, common, {
      student_id: lee.student_id,
      test_status: '실시',
      test_score: 20,
      test_max_score: 20
    })
  ]);
  return { class: cls, students: [hong, kim, lee] };
}

module.exports = { createMemoryStore, seedDemo, emptyTables };
