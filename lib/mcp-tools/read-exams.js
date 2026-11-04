// MCP-only read tools. Entries: { name, progress, description, parameters, call(api, args) }.
import { LMS, str, pick } from './shared.js';

const PERIOD_ID = { type: 'string', description: '시험대비 기간 ID (list_exam_periods로 찾음)' };

export const READ_EXAM_TOOLS = [
  {
    name: 'list_exam_periods',
    progress: '시험대비 기간 확인 중',
    description: '시험대비 기간 목록(exam_period_id, 제목, 기간, 상태, 시험대비 반 수·학생 수·휴강 정규반 수). 최신순.',
    parameters: { type: 'object', properties: {} },
    call(api) {
      return api.getExamPeriods().slice(0, 20).map((p) => pick(p, [
        'exam_period_id', 'title', 'start_date', 'end_date', 'state', 'exam_year', 'exam_semester', 'exam_type',
        'class_count', 'student_count', 'suspended_count', 'memo'
      ]));
    }
  },
  {
    name: 'get_exam_period_detail',
    progress: '시험대비 기간 상세 확인 중',
    description: '시험대비 기간 상세: 시험대비 반별 학생(원래 반, 기간, 상태), 휴강하는 정규반과 복귀일·복귀 학생, 배치되지 않은 학생.',
    parameters: { type: 'object', properties: { exam_period_id: PERIOD_ID }, required: ['exam_period_id'] },
    call(api, args) {
      const d = api.getExamPeriodDetail(str(args.exam_period_id));
      return {
        period: pick(d.period, ['exam_period_id', 'title', 'start_date', 'end_date', 'state', 'exam_year', 'exam_semester', 'exam_type', 'memo']),
        today: d.today,
        classes: d.classes.map((c) => ({
          ...pick(c, ['class_id', 'class_name', 'status', 'teacher', 'target_school', 'target_grade', 'schedule_label', 'lesson_days']),
          students: c.students.map((s) => pick(s, ['rel_id', 'student_id', 'name', 'school', 'source_class_name', 'start_date', 'end_date', 'state']))
        })),
        suspended: d.suspended.map((s) => ({
          ...pick(s, ['class_id', 'class_name', 'last_suspended', 'resume_date']),
          returns: s.returns,
          unplaced: s.unplaced.map((u) => u.name)
        })),
        unplaced_count: d.unplaced_count
      };
    }
  },
  {
    name: 'get_school_exams',
    progress: '학교 시험 일정 확인 중',
    description: '학교 시험 일정(school_exam_id, 학교·학년, 시험일, 디데이, 범위)과 해당 재원생. 학년도·학기·종류로 거릅니다.',
    parameters: {
      type: 'object',
      properties: {
        school_year: { type: 'string', description: '학년도 (예: 2026)' },
        semester: { type: 'string', enum: ['1', '2'], description: '학기' },
        exam_type: { type: 'string', enum: LMS.SCHOOL_EXAM_TYPES, description: '시험 종류' }
      }
    },
    call(api, args) {
      const rows = api.getSchoolExams({ school_year: str(args.school_year), semester: str(args.semester), exam_type: str(args.exam_type) });
      return {
        count: rows.length,
        exams: rows.slice(0, 40).map((e) => ({
          ...pick(e, ['school_exam_id', 'school_year', 'semester', 'label', 'school', 'grade', 'exam_date', 'exam_end_date', 'math_exam_date', 'd_day', 'textbook', 'scope', 'memo']),
          in_progress: e.in_progress,
          students: e.students.map((s) => s.name)
        })),
        truncated: rows.length > 40
      };
    }
  }
];
