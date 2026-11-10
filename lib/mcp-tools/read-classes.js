// MCP-only read tools. Entries: { name, progress, description, parameters, call(api, args) }.
import { str, pick, CLASS_ID, DATE, MONTH } from './shared.js';

const yearMonth = (month) => {
  const m = /^(\d{4})-(\d{2})$/.exec(str(month));
  if (!m) throw new Error('월은 YYYY-MM 형식으로 입력해 주세요.');
  return [Number(m[1]), Number(m[2])];
};

const RANGE = { start_date: DATE('시작일'), end_date: DATE('종료일') };
const range = (args) => ({ start: str(args.start_date), end: str(args.end_date) });

export const READ_CLASS_TOOLS = [
  {
    name: 'get_class_overview',
    progress: '반 개요 확인 중',
    description: '반 개요: 반 정보(시간표·교재·진도), 현재 명단, 다음 수업, 이번 달 출석률·숙제 완료율(homework_rate, A인 숙제 비율)·숙제 평균 점수(homework_average, A 100~F 50 평균)·시험 평균, 최근 수업 3회 요약, 다음 수업·이번 주·이번 달 강의 계획, 다가오는 학교 시험.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID }, required: ['class_id'] },
    call(api, args) {
      const o = api.getClassOverview(str(args.class_id));
      const plan = (p) => (p ? pick(p, ['plan_id', 'period_key', 'title', 'objectives', 'content', 'done_status']) : null);
      return {
        class: pick(o.class, ['class_id', 'class_name', 'grade', 'class_type', 'teacher', 'textbook', 'current_progress', 'schedule_label', 'status', 'memo']),
        today: o.today,
        roster: (o.roster || []).map((s) => pick(s, ['student_id', 'name', 'grade', 'school', 'status'])),
        next: o.next,
        exam: o.exam ? { kind: o.exam.kind, period_title: o.exam.period && o.exam.period.title, resume_date: o.exam.resume_date } : null,
        month: o.month,
        recent: (o.recent || []).map((r) => pick(r, ['date', 'progress', 'content', 'test_title', 'test_scope', 'recorded_count', 'present_count', 'absent_count', 'roster_count'])),
        current_unit: o.current_unit,
        plans: { next_day: plan(o.plans.next_day), week: plan(o.plans.week), month: plan(o.plans.month) },
        exams: (o.exams || []).slice(0, 5).map((e) => ({ ...pick(e, ['school', 'grade', 'label', 'exam_date', 'd_day', 'scope']), student_count: e.student_count }))
      };
    }
  },
  {
    name: 'get_class_progress_log',
    progress: '반 진도 기록 확인 중',
    description: '반의 수업일별 진도·수업 내용·테스트·출결 인원과 그날 일간 계획. 기록이 없는 예정 수업일도 나옵니다(has_record=false). 기간을 비우면 최근 90일, 최신순 30개.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID, ...RANGE }, required: ['class_id'] },
    call(api, args) {
      const log = api.getClassProgressLog(str(args.class_id), range(args));
      return {
        class_name: log.class.class_name,
        start: log.start,
        end: log.end,
        count: log.rows.length,
        rows: log.rows.slice(0, 30).map((r) => ({
          ...pick(r, ['date', 'weekday', 'progress', 'content', 'test_title', 'test_scope', 'class_notice', 'recorded_count', 'absent_count', 'roster_count']),
          has_record: r.has_record,
          plan: r.plan ? pick(r.plan, ['plan_id', 'title', 'content']) : null
        })),
        truncated: log.rows.length > 30
      };
    }
  },
  {
    name: 'get_class_homework_log',
    progress: '반 숙제 기록 확인 중',
    description: '반의 숙제 날짜별 항목(item_id)과 숙제 완료율(rate, A인 숙제 비율), 숙제 평균 점수(average, A 100~F 50 평균), 미완료·미확인 학생과 미완료 항목(A가 아닌 숙제). 숙제 완료는 A일 때만입니다. 기간을 비우면 최근 6주, 최신순 12회.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID, ...RANGE }, required: ['class_id'] },
    call(api, args) {
      const log = api.getClassHomeworkLog(str(args.class_id), range(args));
      const names = {};
      log.students.forEach((s) => { names[s.student_id] = s.name; });
      return {
        start: log.start,
        end: log.end,
        rows: log.rows.slice(0, 12).map((r) => {
          const ids = Object.keys(r.cells || {});
          return {
            date: r.date,
            weekday: r.weekday,
            items: r.items.map((it) => ({ item_id: it.item_id, title: it.title })),
            personal_items: r.personal_items.map((it) => ({ item_id: it.item_id, title: it.title, student: names[it.student_id] || it.student_id })),
            checked: r.checked,
            rate: r.rate,
            average: r.average,
            incomplete: ids.filter((id) => r.cells[id].missing.length).map((id) => ({ student_id: id, name: names[id] || id, missing: r.cells[id].missing })),
            unchecked: ids.filter((id) => r.cells[id].total && !r.cells[id].checked).map((id) => names[id] || id)
          };
        }),
        truncated: log.rows.length > 12
      };
    }
  },
  {
    name: 'get_class_tests',
    progress: '반 테스트 목록 확인 중',
    description: '반에서 테스트를 본 날짜별 제목·범위·만점·응시 인원·평균·최고·최저. 기간을 비우면 최근 6개월, 최신순 20개. 학생별 점수는 get_class_test_detail.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID, ...RANGE }, required: ['class_id'] },
    call(api, args) {
      const t = api.getClassTests(str(args.class_id), range(args));
      return {
        start: t.start,
        end: t.end,
        count: t.rows.length,
        tests: t.rows.slice(0, 20).map((r) => pick(r, ['date', 'weekday', 'title', 'scope', 'max_score', 'difficulty', 'taken_count', 'other_paper_count', 'not_taken_count', 'average', 'high', 'low']))
      };
    }
  },
  {
    name: 'get_class_test_detail',
    progress: '테스트 결과 확인 중',
    description: '한 수업일 테스트의 학생별 출결·응시 여부·점수·등수와 반 통계. 다른 시험지를 본 학생은 시험지별로 따로 집계됩니다.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID, date: DATE('테스트 날짜') }, required: ['class_id', 'date'] },
    call(api, args) {
      const d = api.getClassTestDetail(str(args.class_id), str(args.date));
      return {
        date: d.date,
        session: pick(d.session, ['test_title', 'test_scope', 'test_max_score', 'test_difficulty', 'progress']),
        stats: pick(d.stats, ['count', 'average', 'median', 'high', 'low']),
        papers: d.papers.map((p) => ({
          title: p.title,
          own: p.own,
          max: p.max,
          stats: pick(p.stats, ['count', 'average', 'high', 'low']),
          rows: p.rows.map((r) => pick(r, ['student_id', 'name', 'attendance', 'test_status', 'score', 'max_score', 'rank']))
        }))
      };
    }
  },
  {
    name: 'get_class_trend',
    progress: '반 추이 확인 중',
    description: '반의 월별 수업일 수·출석률·숙제 완료율(homework_rate, A인 숙제 비율)·숙제 평균 점수(homework_average, A 100~F 50 평균)·과제 A 비율·시험 평균 추이. 기본 최근 6개월(최대 12).',
    parameters: {
      type: 'object',
      properties: { class_id: CLASS_ID, months: { type: 'integer', description: '최근 몇 개월 (1–12, 기본 6)' } },
      required: ['class_id']
    },
    call(api, args) {
      return api.getClassTrend(str(args.class_id), args.months).months.map((m) => pick(m, [
        'year', 'month', 'lesson_days', 'attendance_rate', 'homework_rate', 'homework_average', 'assignment_a_rate', 'test_average', 'test_comparable'
      ]));
    }
  },
  {
    name: 'get_class_stats',
    progress: '반 월간 통계 확인 중',
    description: '반의 한 달 통계: 학생별 수업 수·출결·테스트 평균·최고·최저·과제 등급 분포와 반 평균.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID, month: MONTH('월') }, required: ['class_id', 'month'] },
    call(api, args) {
      const [y, m] = yearMonth(args.month);
      const s = api.getClassStats(str(args.class_id), y, m);
      return {
        ...pick(s, ['class_id', 'year', 'month', 'student_count', 'present_count', 'absent_count', 'test_average_display']),
        students: s.students.map((st) => ({
          student_id: st.student_id,
          name: st.name,
          ...pick(st.stats, ['total_lessons', 'present_count', 'absent_count', 'test_count', 'test_average_display', 'test_high_display', 'test_low_display']),
          assignment: ['A', 'B', 'C', 'D', 'E', 'F'].map((g) => st.stats['assignment_' + g] ? g + st.stats['assignment_' + g] : '').filter(Boolean).join(' ')
        }))
      };
    }
  }
];
