// MCP-only read tools. Entries: { name, progress, description, parameters, call(api, args) }.
import { str, pick, STUDENT_ID, CLASS_ID, DATE, MONTH } from './shared.js';

const yearMonth = (month) => {
  const m = /^(\d{4})-(\d{2})$/.exec(str(month));
  if (!m) throw new Error('월은 YYYY-MM 형식으로 입력해 주세요.');
  return [Number(m[1]), Number(m[2])];
};

const clip = (text, max) => {
  const s = str(text);
  return s.length > max ? s.slice(0, max) + '…' : s;
};

export const READ_REPORT_TOOLS = [
  {
    name: 'get_student_reports',
    progress: '학생 리포트 확인 중',
    description: '학생의 월간 리포트(최근 6개, 상태와 본문)와 최근 수업 기록 20개(lesson_id, 일일 리포트용).',
    parameters: { type: 'object', properties: { student_id: STUDENT_ID }, required: ['student_id'] },
    call(api, args) {
      const r = api.getStudentReports(str(args.student_id));
      return {
        monthly: r.monthly.slice(0, 6).map((m) => ({
          ...pick(m, ['monthly_report_id', 'year', 'month', 'status', 'updated_at']),
          text: clip(m.report_text, 700)
        })),
        lessons: r.lessons.map((l) => pick(l, ['lesson_id', 'date', 'class_name', 'attendance']))
      };
    }
  },
  {
    name: 'get_monthly_report_board',
    progress: '월간 리포트 현황 확인 중',
    description: '한 달 월간 리포트 작성 현황(미작성·임시·확정)과 학생별 수업 수·미리보기. class_id를 비우면 재원생 전체.',
    parameters: { type: 'object', properties: { month: MONTH('월'), class_id: CLASS_ID }, required: ['month'] },
    call(api, args) {
      const [y, m] = yearMonth(args.month);
      const b = api.getMonthlyReportBoard(str(args.class_id), y, m);
      return {
        year: b.year,
        month: b.month,
        class_id: b.class_id,
        counts: b.counts,
        rows: b.rows.slice(0, 60).map((r) => pick(r, ['student_id', 'name', 'grade', 'lesson_count', 'status', 'monthly_report_id', 'preview'])),
        truncated: b.rows.length > 60
      };
    }
  },
  {
    name: 'get_daily_report_board',
    progress: '일일 리포트 확인 중',
    description: '반의 한 수업일 일일 리포트(학부모 안내 문자) 본문과, 그날 기록이 없어 리포트가 없는 학생.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID, date: DATE('수업일') }, required: ['class_id', 'date'] },
    call(api, args) {
      const b = api.getDailyReportBoard(str(args.date), str(args.class_id));
      return {
        date: b.date,
        class: b.class,
        meets: b.meets,
        reports: b.reports.map((r) => ({ lesson_id: r.lesson_id, student_id: r.student_id, student_name: r.student_name, text: clip(r.text, 900) })),
        missing: b.missing
      };
    }
  },
  {
    name: 'list_monthly_report_statuses',
    progress: '월간 리포트 상태 확인 중',
    description: '재원생 전체의 한 달 월간 리포트 상태(none=미작성, 임시, 확정)와 monthly_report_id.',
    parameters: { type: 'object', properties: { month: MONTH('월') }, required: ['month'] },
    call(api, args) {
      const [y, m] = yearMonth(args.month);
      const r = api.listMonthlyReportStatuses(y, m);
      const counts = {};
      r.items.forEach((i) => { counts[i.status] = (counts[i.status] || 0) + 1; });
      return {
        year: r.year,
        month: r.month,
        counts,
        items: r.items.slice(0, 80).map((i) => pick(i, ['student_id', 'student_name', 'grade', 'status', 'monthly_report_id'])),
        truncated: r.items.length > 80
      };
    }
  },
  {
    name: 'get_monthly_stats',
    progress: '월간 통계 확인 중',
    description: '학생의 한 달 학습 통계: 수업 수, 출결, 테스트 평균·중간값·최고·최저, 과제·집중도 등급 분포, 진도 요약, 특이사항.',
    parameters: { type: 'object', properties: { student_id: STUDENT_ID, month: MONTH('월') }, required: ['student_id', 'month'] },
    call(api, args) {
      const [y, m] = yearMonth(args.month);
      const s = api.getMonthlyStats(str(args.student_id), y, m);
      const dist = (prefix, keys) => keys.map((k) => (s[prefix + k] ? k + s[prefix + k] : '')).filter(Boolean).join(' ');
      return {
        ...pick(s, ['student_id', 'year', 'month', 'total_lessons', 'present_count', 'absent_count', 'test_count',
          'test_average_display', 'test_median_display', 'test_high_display', 'test_low_display']),
        assignment: dist('assignment_', ['A', 'B', 'C', 'D', 'E', 'F']),
        concentration: dist('concentration_', ['A', 'B', 'C', 'D', 'ABSENT']),
        progress_summary: s.progress_summary,
        special_notes: s.special_notes
      };
    }
  }
];
