'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');

function svc() {
  return LMS.createService(createMemoryStore());
}

describe('IDs and scores', () => {
  it('formats sequential IDs', () => {
    assert.equal(LMS.formatId('STU', 1), 'STU_000001');
    assert.equal(LMS.formatId('CLS', 127), 'CLS_000127');
  });

  it('averages raw scores only when max scores match', () => {
    const same = LMS.collectRawScoresForStats([
      { test_status: '실시', test_score: 18, test_max_score: 20 },
      { test_status: '실시', test_score: 16, test_max_score: 20 }
    ]);
    assert.equal(same.comparable, true);
    assert.deepEqual(same.scores, [18, 16]);
    const mixed = LMS.collectRawScoresForStats([
      { test_status: '실시', test_score: 18, test_max_score: 20 },
      { test_status: '실시', test_score: 40, test_max_score: 50 }
    ]);
    assert.equal(mixed.comparable, false);
    assert.deepEqual(mixed.scores, []);
    assert.equal(mixed.test_count, 2);
  });

  it('returns null instead of NaN for invalid scores', () => {
    assert.equal(LMS.normalizedScore(10, 0), null);
    assert.equal(LMS.normalizedScore('', 20), null);
    assert.equal(LMS.formatAverageDisplay(null), '-');
    assert.equal(LMS.formatAverageDisplay(undefined), '-');
    assert.equal(LMS.formatAverageDisplay(Number.NaN), '-');
  });
});

describe('students classes and lessons', () => {
  it('creates IDs and does not change student_id on update', () => {
    const api = svc();
    const s = api.createStudent({ name: '홍길동', grade: '중2' });
    assert.equal(s.student_id, 'STU_000001');
    const updated = api.updateStudent({ student_id: s.student_id, name: '홍길동2', grade: '중2', status: '재원' });
    assert.equal(updated.student_id, 'STU_000001');
    assert.equal(updated.name, '홍길동2');
  });

  it('keeps class history when moving students', () => {
    const api = svc();
    const a = api.createClass({ class_name: '중2 A반', grade: '중2', weekday: '월/수' });
    const b = api.createClass({ class_name: '중2 B반', grade: '중2', weekday: '화/목' });
    const s = api.createStudent({ name: '홍길동', grade: '중2', class_id: a.class_id, enrollment_date: '2026-03-01' });
    api.saveLesson({
      lesson_date: '2026-03-10',
      student_id: s.student_id,
      class_id: a.class_id,
      attendance: '출석',
      test_status: '미실시'
    });
    api.moveStudent({ student_id: s.student_id, class_id: b.class_id, start_date: '2026-07-01' });
    const hist = api.getStudentClasses(s.student_id);
    assert.equal(hist.length, 2);
    const ended = hist.filter((r) => r.status === '종료')[0];
    const current = hist.filter((r) => r.status === '현재')[0];
    assert.equal(ended.class_id, a.class_id);
    assert.equal(ended.end_date, '2026-06-30');
    assert.equal(current.class_id, b.class_id);
    const oldLesson = api.getStudentLessons(s.student_id)[0];
    assert.equal(oldLesson.class_id, a.class_id);
  });

  it('upserts lessons by date + student + class', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '김철수', class_id: c.class_id });
    const first = api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 10,
      test_max_score: 20,
      progress: '삼각형'
    });
    const second = api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 18,
      test_max_score: 20,
      progress: '사각형'
    });
    assert.equal(first.lesson_id, second.lesson_id);
    assert.equal(api.getLessons('2026-09-14', c.class_id).length, 1);
    assert.equal(second.test_score, 18);
    assert.equal(second.progress, '사각형');
  });

  it('rejects zero max score', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '이영희', class_id: c.class_id });
    assert.throws(() => api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 10,
      test_max_score: 0
    }), /만점은 0보다 커야/);
  });

  it('archives students instead of deleting them', () => {
    const api = svc();
    const s = api.createStudent({ name: '박민수' });
    const archived = api.archiveStudent(s.student_id);
    assert.equal(archived.status, '퇴원');
    assert.equal(api.getStudent(s.student_id).name, '박민수');
  });
});

describe('reports and stats', () => {
  it('excludes 미실시 tests from monthly average and uses raw scores', () => {
    const api = svc();
    const seeded = seedDemo(api);
    api.saveLesson({
      lesson_date: '2026-09-16',
      student_id: seeded.students[0].student_id,
      class_id: seeded.class.class_id,
      attendance: '출석',
      test_status: '실시',
      test_score: 16,
      test_max_score: 20
    });
    const stats = api.getMonthlyStats(seeded.students[0].student_id, 2026, 9);
    assert.equal(stats.test_count, 2);
    assert.equal(stats.test_average, 17);
    assert.equal(stats.test_median, 17);
    assert.equal(stats.test_high, 18);
    assert.equal(stats.test_low, 16);
    assert.equal(stats.test_median_display, '17.0');
    const monthly = api.generateMonthlyReport(seeded.students[0].student_id, 2026, 9);
    assert.match(monthly.text, /평균은 17\.0점입니다\. \(중간값 17\.0점, 최고 18\.0점, 최저 16\.0점\)/);
    const none = api.getMonthlyStats(seeded.students[1].student_id, 2026, 9);
    assert.equal(none.test_count, 0);
    assert.equal(none.test_average_display, '-');
    assert.equal(none.test_median_display, '-');
  });

  it('builds daily reports from lessons and settings', () => {
    const api = svc();
    const seeded = seedDemo(api);
    const batch = api.generateDailyReports('2026-09-14', seeded.class.class_id);
    assert.equal(batch.class_test_average.test_count, 2);
    assert.equal(batch.class_test_average.test_average, 19);
    assert.equal(batch.class_test_average.test_median, 19);
    assert.equal(batch.class_test_average.test_high, 20);
    assert.equal(batch.class_test_average.test_low, 18);
    assert.equal(batch.class_test_average.test_average_display, '19.0');
    assert.equal(batch.class_test_average.test_median_display, '19.0');
    assert.equal(batch.class_test_average.test_high_display, '20.0');
    assert.equal(batch.class_test_average.test_low_display, '18.0');
    assert.deepEqual(batch.reports.map((r) => r.student_name), ['김철수', '이영희', '홍길동']);

    const undone = api.getTodayClassSession('2026-09-14', seeded.class.class_id)
      .students.find((s) => s.name === '김철수');
    const text = api.generateDailyReport(undone.lesson.lesson_id).text;
    assert.match(text, /2026년 9월 14일 월요일/);
    assert.match(text, /김철수 학생/);
    assert.doesNotMatch(text, /출석:/);
    assert.doesNotMatch(text, /집중도:/);
    assert.match(text, /1\. 테스트: 미실시/);
    assert.doesNotMatch(text, /반 평균/);
    assert.match(text, /2\. 과제 이행률: B\(89~70%\)/);
    assert.match(text, /3\. 학습 진도:/);
    assert.match(text, /4\. 과제 안내:/);
    assert.doesNotMatch(text, /과제이행률/);
    assert.doesNotMatch(text, /NaN|undefined|null|#DIV\/0!/);

    const hong = api.getTodayClassSession('2026-09-14', seeded.class.class_id)
      .students.find((s) => s.name === '홍길동');
    const t2 = api.generateDailyReport(hong.lesson.lesson_id).text;
    assert.match(t2, /18 \/ 20/);
    assert.match(t2, /난이도: 중/);
    assert.match(t2, /\(반 평균 19\.0 · 중간값 19\.0 · 최고 20\.0 · 최저 18\.0\)/);
    assert.doesNotMatch(t2, /집중도:/);
    assert.match(t2, /5\. 학생 피드백: 계산 실수가 잦음/);
  });

  it('separates class notice and student feedback in daily reports', () => {
    const api = svc();
    const seeded = seedDemo(api);
    const date = '2026-09-14';
    const classId = seeded.class.class_id;
    api.saveLessonsBatch({
      items: [{
        lesson_date: date,
        class_id: classId,
        student_id: seeded.students.find((s) => s.name === '홍길동').student_id,
        attendance: '출석',
        test_status: '실시',
        test_score: 18,
        test_max_score: 20,
        special_note: '계산 실수가 잦음'
      }],
      class_notice: '다음 주 금요일은 휴강입니다.'
    });
    const hong = api.getTodayClassSession(date, classId)
      .students.find((s) => s.name === '홍길동');
    const text = api.generateDailyReport(hong.lesson.lesson_id).text;
    assert.match(text, /5\. 공지사항: 다음 주 금요일은 휴강입니다\./);
    assert.match(text, /6\. 학생 피드백: 계산 실수가 잦음/);
    assert.equal(api.getClassSessionNotice(date, classId), '다음 주 금요일은 휴강입니다.');
  });

  it('omits class average from daily reports when no tests were taken', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'B반' });
    const s = api.createStudent({ name: '박민수', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '결석',
      test_status: '미실시',
      concentration: 'ABSENT'
    });
    const batch = api.generateDailyReports('2026-09-14', c.class_id);
    assert.equal(batch.class_test_average.test_count, 0);
    assert.equal(batch.class_test_average.test_average_display, '-');
    assert.match(batch.reports[0].text, /1\. 테스트: 미실시/);
    assert.doesNotMatch(batch.reports[0].text, /출석:/);
    assert.doesNotMatch(batch.reports[0].text, /반 평균/);
    assert.doesNotMatch(batch.reports[0].text, /집중도:/);
  });

  it('skips class average when max scores differ', () => {
    const avg = LMS.computeDailyClassTestAverage([
      { test_status: '실시', test_score: 18, test_max_score: 20 },
      { test_status: '실시', test_score: 40, test_max_score: 50 },
      { test_status: '미실시', test_score: 0, test_max_score: 20 }
    ]);
    assert.equal(avg.test_count, 2);
    assert.equal(avg.comparable, false);
    assert.equal(avg.test_average, null);
    assert.equal(avg.test_average_display, '-');
    assert.equal(avg.test_median_display, '-');
  });

  it('computes median for odd and even score lists', () => {
    assert.equal(LMS.median([10, 30, 20]), 20);
    assert.equal(LMS.median([10, 40, 20, 30]), 25);
    assert.equal(LMS.median([]), null);
  });

  it('builds monthly report context for AI and PDF', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '김학생', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-02',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시',
      progress: '1단원'
    });
    const ctx = api.getMonthlyReportContext(s.student_id, 2026, 9);
    assert.equal(ctx.year, 2026);
    assert.equal(ctx.month, 9);
    assert.equal(ctx.lessons.length, 1);
    assert.match(ctx.base_text, /김학생/);
  });

  it('collapses repeated progress in monthly reports', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '홍길동', class_id: c.class_id });
    ['2026-09-01', '2026-09-03', '2026-09-05'].forEach((d) => {
      api.saveLesson({
        lesson_date: d,
        student_id: s.student_id,
        class_id: c.class_id,
        attendance: '출석',
        test_status: '미실시',
        progress: '삼각형의 성질'
      });
    });
    api.saveLesson({
      lesson_date: '2026-09-08',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시',
      progress: '사각형의 성질'
    });
    const stats = api.getMonthlyStats(s.student_id, 2026, 9);
    assert.equal(stats.progress_summary, '삼각형의 성질 → 사각형의 성질');
    const report = api.generateMonthlyReport(s.student_id, 2026, 9);
    assert.match(report.text, /삼각형의 성질 → 사각형의 성질/);
    const saved = api.saveMonthlyReport({
      student_id: s.student_id,
      year: 2026,
      month: 9,
      report_text: report.text,
      status: '확정'
    });
    assert.equal(saved.status, '확정');
    assert.match(saved.monthly_report_id, /^MTH_/);
  });

  it('computes dashboard counts from lessons', () => {
    const api = svc();
    seedDemo(api);
    const dash = api.getDashboard('2026-09-14');
    assert.equal(dash.today_class_count, 1);
    assert.equal(dash.today_student_count, 3);
    assert.equal(dash.recorded_count, 3);
    assert.equal(dash.incomplete_count, 0);
    assert.equal(dash.date_label, '2026년 9월 14일 월요일');
  });
});

describe('bootstrap and caching', () => {
  it('returns dashboard, classes and students in one bootstrap payload', () => {
    const api = svc();
    seedDemo(api);
    const boot = api.getBootstrap();
    assert.equal(boot.settings.academy_name, '학생 관리 시스템');
    assert.equal(boot.today, '2026-09-14');
    assert.equal(boot.classes.length, 1);
    assert.equal(boot.students.length, 3);
    assert.equal(boot.dashboard.today_student_count, 3);
    assert.equal(boot.grades.length, LMS.GRADE_OPTIONS.length);
  });

  it('reads each table at most once per bootstrap', () => {
    const store = createMemoryStore();
    seedDemo(LMS.createService(store));
    const counts = {};
    const orig = store.readTable.bind(store);
    store.readTable = function (name) {
      counts[name] = (counts[name] || 0) + 1;
      return orig(name);
    };
    LMS.createService(store).getBootstrap();
    Object.keys(counts).forEach((name) => {
      assert.ok(counts[name] <= 1, name + ' read ' + counts[name] + ' times');
    });
    assert.equal(counts.Students, 1);
    assert.equal(counts.StudentClasses, 1);
    assert.equal(counts.Classes, 1);
    assert.equal(counts.Lessons, 1);
  });

  it('diffs table rows into updates and appends', () => {
    const prev = [{ lesson_id: 'LES_000001', progress: 'a' }];
    const next = [
      { lesson_id: 'LES_000001', progress: 'b' },
      { lesson_id: 'LES_000002', progress: 'c' }
    ];
    const headers = ['lesson_id', 'progress'];
    const diff = LMS.diffTableRows(prev, next, 'lesson_id', headers);
    assert.equal(diff.needsFullRewrite, false);
    assert.equal(diff.updates.length, 1);
    assert.equal(diff.updates[0].row, 2);
    assert.deepEqual(diff.updates[0].values, ['LES_000001', 'b']);
    assert.equal(diff.appends.length, 1);
    assert.deepEqual(diff.appends[0], ['LES_000002', 'c']);
  });

  it('rewrites when a row is removed', () => {
    const diff = LMS.diffTableRows(
      [{ key: 'a', value: '1' }, { key: 'b', value: '2' }],
      [{ key: 'a', value: '1' }],
      'key',
      ['key', 'value']
    );
    assert.equal(diff.needsFullRewrite, true);
  });

  it('detects sheet header changes for new student and class columns', () => {
    const oldStudents = [
      'student_id', 'name', 'grade', 'parent_phone', 'enrollment_date',
      'status', 'memo', 'created_at', 'updated_at'
    ];
    const oldClasses = [
      'class_id', 'school_year', 'semester', 'grade', 'class_name', 'teacher',
      'weekday', 'start_time', 'end_time', 'memo', 'status', 'created_at', 'updated_at'
    ];
    assert.equal(LMS.headersMatch(oldStudents, LMS.TABLES.Students), false);
    assert.equal(LMS.headersMatch(oldClasses, LMS.TABLES.Classes), false);
    assert.equal(LMS.headersMatch(LMS.TABLES.Students, LMS.TABLES.Students), true);
    assert.deepEqual(
      LMS.compactHeaderRow(['student_id', 'name', '', 'grade']),
      ['student_id', 'name']
    );
  });
});

describe('student extras counseling makeup and calendar', () => {
  it('stores student phone and school', () => {
    const api = svc();
    const s = api.createStudent({
      name: '최민아',
      grade: '중1',
      school: '한빛중학교',
      student_phone: '010-7777-8888',
      parent_phone: '010-9999-0000'
    });
    assert.equal(s.school, '한빛중학교');
    assert.equal(s.student_phone, '010-7777-8888');
    const updated = api.updateStudent(Object.assign({}, s, { school: '새봄중학교' }));
    assert.equal(updated.school, '새봄중학교');
    assert.equal(api.getStudents({ query: '새봄' })[0].student_id, s.student_id);
  });

  it('previews and promotes enrolled students one grade', () => {
    const api = svc();
    api.createStudent({ name: '중2학생', grade: '중2', status: '재원' });
    api.createStudent({ name: '고3학생', grade: '고3', status: '재원' });
    api.createStudent({ name: '휴원학생', grade: '중2', status: '휴원' });
    const preview = api.previewGradePromotion();
    const mid = preview.items.filter((i) => i.from_grade === '중2')[0];
    assert.equal(mid.count, 1);
    assert.equal(mid.to_grade, '중3');
    assert.equal(preview.skipped.length, 1);
    assert.equal(preview.skipped[0].name, '고3학생');
    const result = api.promoteGrades();
    assert.equal(result.updated_count, 1);
    assert.equal(api.getStudent(result.updated[0].student_id).grade, '중3');
    const paused = api.getStudents({ status: '휴원' })[0];
    assert.equal(paused.grade, '중2');
    const high = api.getStudents({ query: '고3학생' })[0];
    assert.equal(high.grade, '고3');
  });

  it('saves class textbook progress and homework', () => {
    const api = svc();
    const c = api.createClass({
      class_name: '중2 A반',
      grade: '중2',
      textbook: '개념원리 중2-2',
      current_progress: '삼각형의 성질',
      class_homework: '워크북 12쪽'
    });
    assert.equal(c.textbook, '개념원리 중2-2');
    const updated = api.updateClass(Object.assign({}, c, { current_progress: '사각형의 성질' }));
    assert.equal(updated.current_progress, '사각형의 성질');
    assert.equal(api.getClass(c.class_id).class_homework, '워크북 12쪽');
  });

  it('creates updates and deletes counseling notes by kind', () => {
    const api = svc();
    const s = api.createStudent({ name: '상담학생', grade: '중2' });
    const note = api.saveCounselingNote({
      student_id: s.student_id,
      kind: '학생',
      counsel_date: '2026-09-10',
      title: '집중도',
      content: '수업 중 산만함'
    });
    assert.match(note.note_id, /^NTS_/);
    const parent = api.saveCounselingNote({
      student_id: s.student_id,
      kind: '학부모',
      counsel_date: '2026-09-12',
      title: '통화',
      content: '숙제 점검 요청'
    });
    const list = api.getCounselingNotes(s.student_id);
    assert.equal(list.length, 2);
    const edited = api.saveCounselingNote(Object.assign({}, note, { content: '집중이 좋아짐' }));
    assert.equal(edited.note_id, note.note_id);
    assert.equal(edited.content, '집중이 좋아짐');
    api.deleteCounselingNote(parent.note_id);
    assert.equal(api.getCounselingNotes(s.student_id).length, 1);
  });

  it('rejects invalid counseling and makeup input', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반' });
    const s = api.createStudent({ name: '김학생', class_id: c.class_id });
    assert.throws(() => api.saveCounselingNote({
      student_id: s.student_id,
      kind: '학생',
      counsel_date: '2026-09-10',
      content: ''
    }), /상담 내용/);
    assert.throws(() => api.saveMakeupSession({
      kind: '반',
      makeup_date: '2026-09-16'
    }), /반을 선택/);
    assert.throws(() => api.saveMakeupSession({
      kind: '학생',
      makeup_date: '2026-09-16',
      student_id: ''
    }), /학생을 선택/);
  });

  it('creates one makeup session per selected student', () => {
    const api = svc();
    const seeded = seedDemo(api);
    const res = api.saveMakeupSession({
      kind: '학생',
      class_id: seeded.class.class_id,
      makeup_date: '2026-09-18',
      start_time: '18:00',
      end_time: '19:00',
      student_ids: [seeded.students[0].student_id, seeded.students[1].student_id]
    });
    assert.equal(res.created_count, 2);
    assert.equal(res.sessions.length, 2);
    const cal = api.getCalendar('2026-09-18', '2026-09-18');
    const personal = cal.events.filter((e) => e.event_type === '개인보강');
    assert.equal(personal.length, 2);
    assert.deepEqual(personal.map((e) => e.title).sort(), ['김철수 보강', '홍길동 보강']);
    assert.throws(() => api.saveMakeupSession({
      makeup_id: res.sessions[0].makeup_id,
      kind: '학생',
      makeup_date: '2026-09-18',
      student_ids: [seeded.students[0].student_id, seeded.students[1].student_id]
    }), /한 명만/);
  });

  it('attaches that day class average to student lessons', () => {
    const api = svc();
    const seeded = seedDemo(api);
    api.saveLessonsBatch([
      {
        lesson_date: '2026-09-16',
        student_id: seeded.students[0].student_id,
        class_id: seeded.class.class_id,
        attendance: '출석',
        test_status: '실시',
        test_score: 10,
        test_max_score: 20
      },
      {
        lesson_date: '2026-09-16',
        student_id: seeded.students[2].student_id,
        class_id: seeded.class.class_id,
        attendance: '출석',
        test_status: '실시',
        test_score: 16,
        test_max_score: 20
      }
    ]);
    const rows = api.getStudentLessons(seeded.students[0].student_id, '2026-09-01', '2026-09-30');
    const byDate = {};
    rows.forEach((r) => { byDate[r.lesson_date] = r; });
    assert.equal(byDate['2026-09-14'].class_test_average.test_average, 19);
    assert.equal(byDate['2026-09-14'].class_test_average.test_average_display, '19.0');
    assert.equal(byDate['2026-09-16'].class_test_average.test_average, 13);
    assert.equal(byDate['2026-09-16'].class_test_average.test_average_display, '13.0');
  });

  it('puts regular classes and makeup sessions on the calendar', () => {
    const api = svc();
    const seeded = seedDemo(api);
    const classMakeup = api.saveMakeupSession({
      kind: '반',
      class_id: seeded.class.class_id,
      makeup_date: '2026-09-16',
      start_time: '18:00',
      end_time: '20:00',
      title: '중간고사 보강'
    });
    const personal = api.saveMakeupSession({
      kind: '학생',
      student_id: seeded.students[0].student_id,
      class_id: seeded.class.class_id,
      makeup_date: '2026-09-17',
      start_time: '19:00:00',
      end_time: '20:00:00'
    });
    assert.equal(personal.start_time, '19:00');
    const cal = api.getCalendar('2026-09-14', '2026-09-17');
    const regularMon = cal.events.filter((e) => e.event_type === '정규' && e.date === '2026-09-14');
    const regularTue = cal.events.filter((e) => e.event_type === '정규' && e.date === '2026-09-15');
    assert.equal(regularMon.length, 1);
    assert.equal(regularTue.length, 0);
    assert.equal(cal.events.filter((e) => e.event_type === '반보강').length, 1);
    assert.equal(cal.events.filter((e) => e.event_type === '개인보강')[0].title, '홍길동 보강');
    api.cancelMakeupSession(classMakeup.makeup_id);
    const after = api.getCalendar('2026-09-14', '2026-09-17');
    assert.equal(after.events.filter((e) => e.event_type === '반보강').length, 0);
  });

  it('computes monday-based week range', () => {
    const week = LMS.weekRange('2026-09-16');
    assert.equal(week.start, '2026-09-14');
    assert.equal(week.end, '2026-09-20');
    assert.equal(LMS.nextGrade('중2'), '중3');
    assert.equal(LMS.nextGrade('고3'), '');
    assert.equal(LMS.nextGrade('기타'), '');
  });
});

describe('teacher features', () => {
  it('detects learning signals from recent lessons', () => {
    const lessons = [
      { lesson_date: '2026-09-01', test_status: '실시', test_score: 18, test_max_score: 20, assignment_completion: 'A', concentration: 'A' },
      { lesson_date: '2026-09-08', test_status: '실시', test_score: 17, test_max_score: 20, assignment_completion: 'A', concentration: 'A' },
      { lesson_date: '2026-09-10', test_status: '실시', test_score: 16, test_max_score: 20, assignment_completion: 'A', concentration: 'A' },
      { lesson_date: '2026-09-11', test_status: '실시', test_score: 15, test_max_score: 20, assignment_completion: 'B', concentration: 'B' },
      { lesson_date: '2026-09-12', test_status: '실시', test_score: 10, test_max_score: 20, assignment_completion: 'C', concentration: 'D' },
      { lesson_date: '2026-09-14', test_status: '실시', test_score: 9, test_max_score: 20, assignment_completion: 'C', concentration: 'D' }
    ];
    const signals = LMS.detectLearningSignals(lessons);
    assert.ok(signals.some((s) => s.code === 'assignment_c_streak'));
    assert.ok(signals.some((s) => s.code === 'concentration_low_streak'));
    assert.ok(signals.some((s) => s.code === 'test_score_drop'));
  });

  it('returns last lesson snapshot for a class', () => {
    const api = svc();
    const c = api.createClass({ class_name: '중2 A반', weekday: '월' });
    const s = api.createStudent({ name: '김철수', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-10',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시',
      progress: '이차방정식',
      homework: 'p.20',
      assignment_completion: 'B'
    });
    const snap = api.getLastLessonSnapshot(c.class_id, '2026-09-14');
    assert.equal(snap.lesson_date, '2026-09-10');
    assert.equal(snap.progress, '이차방정식');
    assert.equal(snap.homework, 'p.20');
    assert.equal(snap.student_assignments[s.student_id], 'B');
  });

  it('builds teaching tasks and learning alerts on dashboard', () => {
    const api = svc();
    seedDemo(api);
    const tasks = api.getTodayTeachingTasks('2026-09-14');
    assert.equal(tasks.regular_classes.length, 1);
    assert.equal(tasks.regular_classes[0].complete, true);
    const dash = api.getDashboard('2026-09-14');
    assert.ok(dash.teaching_tasks);
    assert.ok(dash.agenda);
    assert.ok(Array.isArray(dash.learning_alerts));
    const ctx = api.getStudentLearningContext(api.getStudents({})[0].student_id);
    assert.ok(ctx.summary);
    assert.ok(Array.isArray(ctx.signals));
  });
});

describe('agenda and tasks', () => {
  it('saves manual tasks and lists them on the day agenda', () => {
    const api = svc();
    const c = api.createClass({ class_name: '중2 A반', weekday: '월' });
    const s = api.createStudent({ name: '홍길동', class_id: c.class_id });
    const task = api.saveTask({
      due_date: '2026-09-14',
      kind: 'counsel_parent',
      title: '학부모 상담',
      memo: '중간고사 후',
      student_id: s.student_id,
      class_id: c.class_id
    });
    assert.match(task.task_id, /^TSK_/);
    assert.equal(task.source, 'manual');
    assert.equal(task.status, '예정');
    const agenda = api.getDayAgenda('2026-09-14');
    const manual = agenda.items.filter((item) => item.source === 'manual');
    assert.equal(manual.length, 1);
    assert.equal(manual[0].id, task.task_id);
    assert.equal(manual[0].kind, 'counsel_parent');
    assert.equal(manual[0].student_name, '홍길동');
  });

  it('includes incomplete class on agenda and removes it after lessons are recorded', () => {
    const api = svc();
    const c = api.createClass({ class_name: '중2 A반', weekday: '월' });
    const a = api.createStudent({ name: '김철수', class_id: c.class_id });
    const b = api.createStudent({ name: '이영희', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-07',
      student_id: a.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시',
      homework: 'p.20 복습'
    });

    let agenda = api.getDayAgenda('2026-09-14');
    const incomplete = agenda.items.filter((item) => item.kind === 'incomplete_class');
    assert.equal(incomplete.length, 1);
    assert.equal(incomplete[0].class_id, c.class_id);
    assert.equal(incomplete[0].incomplete_count, 2);
    const hwCheck = agenda.items.find((item) => item.kind === 'homework_check' && item.class_id === c.class_id);
    assert.ok(hwCheck);
    assert.equal(hwCheck.prior_lesson_date, '2026-09-07');

    api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: a.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시'
    });
    api.saveLesson({
      lesson_date: '2026-09-14',
      student_id: b.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시'
    });

    agenda = api.getDayAgenda('2026-09-14');
    assert.equal(agenda.items.filter((item) => item.kind === 'incomplete_class').length, 0);
    const dash = api.getDashboard('2026-09-14');
    assert.ok(dash.agenda);
    assert.equal(dash.teaching_tasks.regular_classes[0].complete, true);
  });

  it('skips empty-roster classes from incomplete_class agenda items', () => {
    const api = svc();
    const today = '2026-09-14';
    assert.equal(LMS.weekdayName(today), '월');
    const empty = api.createClass({ class_name: '빈 반', weekday: '월' });
    const agenda = api.getDayAgenda(today);
    const incompleteForEmpty = agenda.items.filter(
      (item) => item.kind === 'incomplete_class' && item.class_id === empty.class_id
    );
    assert.equal(incompleteForEmpty.length, 0);
  });

  it('adds learning_alert items only on today agenda', () => {
    const api = svc();
    const c = api.createClass({ class_name: '중2 A반', weekday: '월' });
    const s = api.createStudent({ name: '신호학생', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-12',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시',
      assignment_completion: 'C',
      concentration: 'D'
    });
    api.saveLesson({
      lesson_date: '2026-09-13',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시',
      assignment_completion: 'C',
      concentration: 'D'
    });
    const todayAgenda = api.getDayAgenda('2026-09-14');
    assert.ok(
      todayAgenda.items.some(
        (item) => item.kind === 'learning_alert' && item.student_id === s.student_id
      )
    );
    const yesterdayAgenda = api.getDayAgenda('2026-09-13');
    assert.equal(
      yesterdayAgenda.items.filter((item) => item.kind === 'learning_alert').length,
      0
    );
  });

  it('updates task status and hides cancelled tasks from agenda', () => {
    const api = svc();
    const task = api.saveTask({
      due_date: '2026-09-14',
      kind: 'admin',
      title: '교재 주문'
    });
    const done = api.updateTaskStatus(task.task_id, '완료');
    assert.equal(done.status, '완료');
    let agenda = api.getDayAgenda('2026-09-14');
    assert.ok(agenda.items.some((item) => item.id === task.task_id && item.status === '완료'));
    api.updateTaskStatus(task.task_id, '취소');
    agenda = api.getDayAgenda('2026-09-14');
    assert.equal(agenda.items.filter((item) => item.id === task.task_id).length, 0);
  });

  it('lists monthly report statuses for enrolled students', () => {
    const api = svc();
    const seeded = seedDemo(api);
    api.saveMonthlyReport({
      student_id: seeded.students[0].student_id,
      year: 2026,
      month: 9,
      report_text: '임시 보고서',
      status: '임시'
    });
    api.saveMonthlyReport({
      student_id: seeded.students[1].student_id,
      year: 2026,
      month: 9,
      report_text: '확정 보고서',
      status: '확정'
    });
    const listed = api.listMonthlyReportStatuses(2026, 9);
    assert.equal(listed.year, 2026);
    assert.equal(listed.month, 9);
    assert.equal(listed.items.length, 3);
    const byName = Object.fromEntries(listed.items.map((row) => [row.student_name, row]));
    assert.equal(byName['홍길동'].status, '임시');
    assert.equal(byName['김철수'].status, '확정');
    assert.equal(byName['이영희'].status, 'none');
  });

  it('lists counseling notes across students with filters', () => {
    const api = svc();
    const seeded = seedDemo(api);
    api.saveCounselingNote({
      student_id: seeded.students[0].student_id,
      kind: '학부모',
      counsel_date: '2026-09-10',
      title: '중간고사',
      content: '성적 상담'
    });
    api.saveCounselingNote({
      student_id: seeded.students[1].student_id,
      kind: '학생',
      counsel_date: '2026-09-12',
      title: '학습태도',
      content: '집중 독려'
    });
    const all = api.listCounselingNotes({ start: '2026-09-01', end: '2026-09-30' });
    assert.equal(all.length, 2);
    assert.ok(all.every((row) => row.student_name));
    const parents = api.listCounselingNotes({ kind: '학부모' });
    assert.equal(parents.length, 1);
    assert.equal(parents[0].student_name, '홍길동');
    const searched = api.listCounselingNotes({ query: '집중' });
    assert.equal(searched.length, 1);
    assert.equal(searched[0].student_name, '김철수');
    const one = api.listCounselingNotes({ student_id: seeded.students[0].student_id });
    assert.equal(one.length, 1);
  });
});

describe('class lesson plans', () => {
  it('normalizes weekly keys to Monday and monthly keys to YYYY-MM', () => {
    assert.equal(LMS.normalizePlanPeriodKey('주간', '2026-09-16'), '2026-09-14');
    assert.equal(LMS.normalizePlanPeriodKey('월간', '2026-09-16'), '2026-09');
    assert.equal(LMS.normalizePlanPeriodKey('월간', '2026-09'), '2026-09');
    assert.equal(LMS.normalizePlanPeriodKey('일간', '2026-09-16'), '2026-09-16');
  });

  it('upserts plans by class + period and supports delete', () => {
    const api = svc();
    const c = api.createClass({ class_name: '중2 A반', weekday: '월/수' });
    const first = api.saveClassPlan({
      class_id: c.class_id,
      period_type: '일간',
      period_key: '2026-09-14',
      title: '이차방정식 도입',
      content: '근의 공식 예습'
    });
    assert.match(first.plan_id, /^PLN_/);
    assert.equal(first.period_key, '2026-09-14');
    assert.match(first.period_label, /2026년 9월 14일/);

    const second = api.saveClassPlan({
      class_id: c.class_id,
      period_type: '일간',
      period_key: '2026-09-14',
      title: '이차방정식 도입(수정)',
      objectives: '근의 공식 이해',
      content: '예제 3문항'
    });
    assert.equal(second.plan_id, first.plan_id);
    assert.equal(second.title, '이차방정식 도입(수정)');
    assert.equal(api.getClassPlans({ class_id: c.class_id, period_type: '일간' }).length, 1);

    const got = api.getClassPlan(c.class_id, '일간', '2026-09-14');
    assert.equal(got.content, '예제 3문항');

    api.deleteClassPlan(got.plan_id);
    assert.equal(api.getClassPlan(c.class_id, '일간', '2026-09-14'), null);
    assert.equal(api.getClassPlans({ class_id: c.class_id }).length, 0);
  });

  it('saves weekly from mid-week anchor and monthly by year-month', () => {
    const api = svc();
    const c = api.createClass({ class_name: '중2 B반', weekday: '화/목' });
    const week = api.saveClassPlan({
      class_id: c.class_id,
      period_type: '주간',
      period_key: '2026-09-16',
      title: '이번 주 복습',
      materials: '교재 p.40-48'
    });
    assert.equal(week.period_key, '2026-09-14');
    assert.equal(week.period_start, '2026-09-14');
    assert.equal(week.period_end, '2026-09-20');
    assert.equal(api.getClassPlan(c.class_id, '주간', '2026-09-18').plan_id, week.plan_id);

    const month = api.saveClassPlan({
      class_id: c.class_id,
      period_type: '월간',
      period_key: '2026-09',
      title: '9월 단원 계획',
      homework: '주 2회 오답노트'
    });
    assert.equal(month.period_key, '2026-09');
    assert.equal(api.getClassPlan(c.class_id, '월간', '2026-09-01').plan_id, month.plan_id);
    assert.equal(api.getClassPlans({ class_id: c.class_id }).length, 2);
  });

  it('rejects empty plans and attaches daily_plan to today session', () => {
    const api = svc();
    const c = api.createClass({ class_name: '중2 A반', weekday: '월' });
    assert.throws(() => api.saveClassPlan({
      class_id: c.class_id,
      period_type: '일간',
      period_key: '2026-09-14'
    }), /계획 내용/);

    const emptySession = api.getTodayClassSession('2026-09-14', c.class_id);
    assert.equal(emptySession.daily_plan, null);

    api.saveClassPlan({
      class_id: c.class_id,
      period_type: '일간',
      period_key: '2026-09-14',
      title: '오늘 진도',
      content: '일차방정식 복습'
    });
    const session = api.getTodayClassSession('2026-09-14', c.class_id);
    assert.ok(session.daily_plan);
    assert.equal(session.daily_plan.title, '오늘 진도');
    assert.equal(session.daily_plan.content, '일차방정식 복습');
  });
});

describe('homework checklist and weekly dashboard', () => {
  it('computes previous class meeting and assignment grades', () => {
    assert.equal(LMS.previousClassMeetingDate('화/목/토', '2026-09-15'), '2026-09-12'); // 화←토
    assert.equal(LMS.previousClassMeetingDate('화/목/토', '2026-09-17'), '2026-09-15'); // 목←화
    assert.equal(LMS.previousClassMeetingDate('월/수/금', '2026-09-14'), '2026-09-11'); // 월←금
    assert.equal(LMS.assignmentGradeFromChecks(2, 2), 'A');
    assert.equal(LMS.assignmentGradeFromChecks(1, 2), 'C');
    assert.equal(LMS.assignmentGradeFromChecks(7, 10), 'B');
    assert.equal(LMS.assignmentGradeFromChecks(0, 0), '');
  });

  it('saves homework slots and checks them next class with A/B/C', () => {
    const api = svc();
    const c = api.createClass({ class_name: '화목토반', weekday: '화/목/토' });
    const a = api.createStudent({ name: '김완료', class_id: c.class_id });
    const b = api.createStudent({ name: '이일부', class_id: c.class_id });
    const assigned = '2026-09-12'; // 토
    const checkDate = '2026-09-15'; // 화
    const saved = api.saveSessionHomework({
      lesson_date: assigned,
      class_id: c.class_id,
      titles: ['워크북 10쪽', '오답노트']
    });
    assert.equal(saved.items.length, 2);
    assert.match(saved.items[0].item_id, /^HWI_/);

    const result = api.saveHomeworkChecks({
      lesson_date: assigned,
      class_id: c.class_id,
      check_date: checkDate,
      checks: [
        { student_id: a.student_id, item_id: saved.items[0].item_id, status: '완료' },
        { student_id: a.student_id, item_id: saved.items[1].item_id, status: '완료' },
        { student_id: b.student_id, item_id: saved.items[0].item_id, status: '완료' },
        { student_id: b.student_id, item_id: saved.items[1].item_id, status: '미완료' }
      ]
    });
    const byStudent = Object.fromEntries(result.grades.map((g) => [g.student_id, g]));
    assert.equal(byStudent[a.student_id].assignment_completion, 'A');
    assert.equal(byStudent[b.student_id].assignment_completion, 'C');

    const session = api.getTodayClassSession(checkDate, c.class_id);
    assert.equal(session.prior_homework.assigned_date, assigned);
    assert.equal(session.prior_homework.items.length, 2);
    assert.equal(session.prior_homework.checks_by_student[a.student_id][saved.items[0].item_id], '완료');
  });

  it('builds weekly must-complete slots for 화목토 and 월수금', () => {
    const api = svc();
    const tue = api.createClass({ class_name: '화목토반', weekday: '화/목/토' });
    const mon = api.createClass({ class_name: '월수금반', weekday: '월/수/금' });
    api.createStudent({ name: '화목토학생', class_id: tue.class_id });
    api.createStudent({ name: '월수금학생', class_id: mon.class_id });

    // week of 2026-09-14 (Mon) .. 2026-09-20 (Sun)
    api.saveSessionHomework({
      lesson_date: '2026-09-12', class_id: tue.class_id, titles: ['토 숙제']
    });
    api.saveSessionHomework({
      lesson_date: '2026-09-15', class_id: tue.class_id, titles: ['화 숙제']
    });
    api.saveSessionHomework({
      lesson_date: '2026-09-17', class_id: tue.class_id, titles: ['목 숙제']
    });
    api.saveSessionHomework({
      lesson_date: '2026-09-11', class_id: mon.class_id, titles: ['금 숙제']
    });
    api.saveSessionHomework({
      lesson_date: '2026-09-14', class_id: mon.class_id, titles: ['월 숙제']
    });
    api.saveSessionHomework({
      lesson_date: '2026-09-16', class_id: mon.class_id, titles: ['수 숙제']
    });

    const dash = api.getWeeklyHomeworkDashboard('2026-09-16');
    assert.equal(dash.week_start, '2026-09-14');
    assert.equal(dash.week_end, '2026-09-20');
    const byName = Object.fromEntries(dash.classes.map((c) => [c.class_name, c]));
    assert.deepEqual(byName['화목토반'].slots.map((s) => s.assigned_date), [
      '2026-09-12', '2026-09-15', '2026-09-17'
    ]);
    assert.deepEqual(byName['화목토반'].slots.map((s) => s.check_date), [
      '2026-09-15', '2026-09-17', '2026-09-19'
    ]);
    assert.deepEqual(byName['월수금반'].slots.map((s) => s.assigned_date), [
      '2026-09-11', '2026-09-14', '2026-09-16'
    ]);
    assert.equal(byName['화목토반'].slots[0].items[0].title, '토 숙제');
    assert.ok(api.getDashboard('2026-09-16').weekly_homework);
  });

  it('materializes legacy homework text into checklist items', () => {
    const api = svc();
    const c = api.createClass({ class_name: 'A반', weekday: '월/수' });
    const s = api.createStudent({ name: '레거시', class_id: c.class_id });
    api.saveLesson({
      lesson_date: '2026-09-09',
      student_id: s.student_id,
      class_id: c.class_id,
      attendance: '출석',
      test_status: '미실시',
      homework: '프린트 1\n프린트 2'
    });
    const prior = api.getTodayClassSession('2026-09-14', c.class_id).prior_homework;
    assert.equal(prior.assigned_date, '2026-09-09');
    assert.equal(prior.from_legacy, true);
    assert.equal(prior.items.length, 2);
    const checked = api.saveHomeworkChecks({
      lesson_date: '2026-09-09',
      class_id: c.class_id,
      check_date: '2026-09-14',
      checks: [
        { student_id: s.student_id, index: 0, status: '완료' },
        { student_id: s.student_id, index: 1, status: '완료' }
      ]
    });
    assert.equal(checked.items.length, 2);
    assert.match(checked.items[0].item_id, /^HWI_/);
    assert.equal(checked.grades[0].assignment_completion, 'A');
  });

  it('preserves homework item ids and checks when re-saving the same titles', () => {
    const api = svc();
    const c = api.createClass({ class_name: '보존반', weekday: '화/목/토' });
    const s = api.createStudent({ name: '체크학생', class_id: c.class_id });
    const assigned = '2026-09-12';
    const first = api.saveSessionHomework({
      lesson_date: assigned,
      class_id: c.class_id,
      titles: ['워크북', '오답노트']
    });
    const id0 = first.items[0].item_id;
    const id1 = first.items[1].item_id;
    api.saveHomeworkChecks({
      lesson_date: assigned,
      class_id: c.class_id,
      check_date: '2026-09-15',
      checks: [
        { student_id: s.student_id, item_id: id0, status: '완료' },
        { student_id: s.student_id, item_id: id1, status: '미완료' }
      ]
    });

    const again = api.saveSessionHomework({
      lesson_date: assigned,
      class_id: c.class_id,
      titles: ['워크북', '오답노트']
    });
    assert.equal(again.items[0].item_id, id0);
    assert.equal(again.items[1].item_id, id1);

    const renamed = api.saveSessionHomework({
      lesson_date: assigned,
      class_id: c.class_id,
      items: [
        { item_id: id0, title: '워크북 개정' },
        { item_id: id1, title: '오답노트' }
      ]
    });
    assert.equal(renamed.items[0].item_id, id0);
    assert.equal(renamed.items[0].title, '워크북 개정');

    const session = api.getSessionHomework(assigned, c.class_id);
    const check = session.checks.find((row) =>
      row.item_id === id0 && row.student_id === s.student_id
    );
    assert.ok(check);
    assert.equal(check.status, '완료');
  });
});
