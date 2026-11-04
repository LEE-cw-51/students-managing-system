// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, DATE } from './shared.js';

const PERIOD_ID = { type: 'string', description: '시험대비 기간 ID (예: EXP-0001). list_exam_periods로 찾습니다.' };
const SCHOOL_EXAM_ID = { type: 'string', description: '학교 시험 일정 ID (예: SCX-0003). get_school_exams로 찾습니다.' };

const PERIOD_FIELDS = {
  title: { type: 'string', description: '기간 이름 (예: 2학기 중간)' },
  start_date: DATE('시작일'),
  end_date: DATE('종료일 (시작일부터 두 달 이내)'),
  exam_year: { type: 'string', description: '학년도 (예: 2026, 선택)' },
  exam_semester: { type: 'string', description: '학기 1 또는 2 (선택)' },
  exam_type: { type: 'string', enum: LMS.SCHOOL_EXAM_TYPES, description: '시험 종류 (선택)' },
  memo: { type: 'string', description: '메모 (선택)' }
};

const SCHOOL_EXAM = {
  type: 'object',
  properties: {
    school_exam_id: { ...SCHOOL_EXAM_ID, description: '고칠 일정 ID (선택). 없으면 같은 학교·학년·학년도·학기·시험을 찾아 고치거나 새로 만듭니다.' },
    school: { type: 'string', description: '학교 이름' },
    grade: { type: 'string', description: '학년 (예: 중2)' },
    school_year: { type: 'string', description: '학년도 4자리 (예: 2026)' },
    semester: { type: 'string', enum: ['1', '2'], description: '학기' },
    exam_type: { type: 'string', enum: LMS.SCHOOL_EXAM_TYPES, description: '중간, 기말, 기타' },
    title: { type: 'string', description: '시험 이름 (기타일 때 필수)' },
    exam_date: DATE('시험 시작일 (선택)'),
    exam_end_date: DATE('시험 종료일 (선택)'),
    math_exam_date: DATE('수학 시험일 (선택, 시험 기간 안)'),
    textbook: { type: 'string', description: '교재 (선택)' },
    scope: { type: 'string', description: '시험 범위 (선택)' },
    memo: { type: 'string', description: '메모 (선택)' }
  },
  required: ['school', 'grade', 'school_year', 'semester', 'exam_type']
};

export const WRITE_EXAM_TOOLS = [
  {
    name: 'create_exam_period',
    progress: '시험대비 기간 추가 준비 중',
    description: '시험대비 기간을 새로 만듭니다(상태 준비). 시험대비 반 편성과 휴강 반 지정은 따로 합니다.',
    destructive: false,
    parameters: { type: 'object', properties: { ...PERIOD_FIELDS }, required: ['title', 'start_date', 'end_date'] }
  },
  {
    name: 'update_exam_period',
    progress: '시험대비 기간 수정 준비 중',
    description: '시험대비 기간의 이름·날짜·시험 정보를 고칩니다. 넣지 않은 항목은 그대로 둡니다. 기간을 줄이면 시험대비 반의 임시 배정도 새 기간 안으로 줄어듭니다.',
    parameters: { type: 'object', properties: { exam_period_id: PERIOD_ID, ...PERIOD_FIELDS }, required: ['exam_period_id'] }
  },
  {
    name: 'close_exam_period',
    progress: '시험대비 기간 마감 준비 중',
    description: '시험대비 기간을 마감합니다. 그 기간의 시험대비 반도 모두 종료됩니다. 마감 전에 사용자에게 확인합니다.',
    parameters: { type: 'object', properties: { exam_period_id: PERIOD_ID }, required: ['exam_period_id'] }
  },
  {
    name: 'delete_exam_period',
    progress: '시험대비 기간 삭제 준비 중',
    description: '수업 기록이 없는 시험대비 기간을 지웁니다. 그 기간의 시험대비 반, 임시 배정, 진도 계획, 숙제도 함께 지워지고 휴강 반 지정이 풀립니다. 수업 기록이 있으면 close_exam_period를 씁니다. 지우기 전에 영향 범위를 사용자에게 확인합니다.',
    parameters: { type: 'object', properties: { exam_period_id: PERIOD_ID }, required: ['exam_period_id'] }
  },
  {
    name: 'set_exam_period_suspended_classes',
    progress: '휴강 반 지정 준비 중',
    description: '시험대비 기간 동안 쉬는 정규 반 목록을 통째로 바꿉니다. 지금 목록은 get_exam_period_detail로 확인하고, 빠뜨린 반은 휴강이 풀립니다. 빈 목록이면 모두 해제합니다.',
    parameters: {
      type: 'object',
      properties: {
        exam_period_id: PERIOD_ID,
        class_ids: { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: { type: 'string' }, description: '휴강할 정규 반 ID 전체 목록 (list_classes로 찾음)' }
      },
      required: ['exam_period_id', 'class_ids']
    }
  },
  {
    name: 'save_school_exam',
    progress: '학교 시험 일정 저장 준비 중',
    description: '학교 수학 시험 일정 하나를 추가하거나 고칩니다. 같은 학교·학년·학년도·학기·시험이 이미 있으면 그 일정을 덮어씁니다.',
    parameters: SCHOOL_EXAM
  },
  {
    name: 'save_school_exams_batch',
    progress: '학교 시험 일정 저장 준비 중',
    description: `학교 시험 일정을 여러 건 한 번에 추가하거나 고칩니다(최대 ${LMS.AGENT_BATCH_MAX}건). 각 항목은 save_school_exam과 같고, 이미 있는 시험은 덮어씁니다.`,
    parameters: {
      type: 'object',
      properties: { exams: { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: SCHOOL_EXAM, description: '시험 일정 목록' } },
      required: ['exams']
    }
  },
  {
    name: 'delete_school_exam',
    progress: '학교 시험 일정 삭제 준비 중',
    description: '학교 시험 일정 하나를 지웁니다. 지우기 전에 어떤 시험인지 사용자에게 확인합니다.',
    parameters: { type: 'object', properties: { school_exam_id: SCHOOL_EXAM_ID }, required: ['school_exam_id'] }
  }
];
