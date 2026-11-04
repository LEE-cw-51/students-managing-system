// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, STUDENT_ID, CLASS_ID, DATE } from './shared.js';

const REL_ID = { type: 'string', description: '반 배정 ID (예: REL-0003). 모르면 비우고 student_id와 class_id를 함께 넣습니다.' };
const REL_STUDENT = { type: 'string', description: '학생 ID (rel_id 대신 class_id와 함께 사용, search_students로 찾음)' };
const REL_CLASS = { type: 'string', description: '반 ID (rel_id 대신 student_id와 함께 사용, get_student_profile의 classes 또는 list_classes로 찾음)' };

const STUDENT_FIELDS = {
  name: { type: 'string', description: '학생 이름' },
  grade: { type: 'string', enum: LMS.GRADE_OPTIONS, description: '학년' },
  school: { type: 'string', description: '학교' },
  student_phone: { type: 'string', description: '학생 전화번호' },
  parent_phone: { type: 'string', description: '학부모 전화번호' },
  enrollment_date: DATE('등록일'),
  status: { type: 'string', enum: LMS.STUDENT_STATUS, description: '재원, 휴원, 퇴원' },
  memo: { type: 'string', description: '메모' }
};

export const WRITE_STUDENT_TOOLS = [
  {
    name: 'create_student',
    progress: '학생 추가 준비 중',
    description: '새 학생을 등록합니다. class_id를 넣으면 등록일부터 그 반에 배정합니다(반은 list_classes로 찾음). 같은 이름 학생이 있는지 search_students로 먼저 확인합니다.',
    parameters: {
      type: 'object',
      properties: { ...STUDENT_FIELDS, class_id: { ...CLASS_ID, description: '처음 배정할 반 ID (선택, list_classes로 찾음)' } },
      required: ['name']
    },
    destructive: false
  },
  {
    name: 'update_student',
    progress: '학생 정보 수정 준비 중',
    description: '학생 정보(이름·학년·학교·연락처·등록일·상태·메모)를 고칩니다. 바꿀 항목만 넣습니다. 상태를 퇴원으로 바꾸면 다니는 반 배정이 모두 끝납니다. student_id는 search_students로 찾습니다.',
    parameters: {
      type: 'object',
      properties: {
        student_id: STUDENT_ID,
        ...STUDENT_FIELDS,
        sync_class_start: { type: 'boolean', description: '등록일을 바꿀 때 첫 반 시작일도 함께 옮김' }
      },
      required: ['student_id']
    }
  },
  {
    name: 'archive_student',
    progress: '퇴원 처리 준비 중',
    description: '학생을 퇴원 처리합니다. 다니는 반 배정과 시험대비 배정이 끝나고, 기록은 남습니다. student_id는 search_students로 찾습니다.',
    parameters: { type: 'object', properties: { student_id: STUDENT_ID }, required: ['student_id'] }
  },
  {
    name: 'set_students_status',
    progress: '학생 상태 변경 준비 중',
    description: '여러 학생의 상태(재원·휴원·퇴원)를 한꺼번에 바꿉니다. 퇴원이면 각 학생의 반 배정이 끝납니다. student_id는 search_students(include_inactive) 또는 get_class_members로 찾습니다.',
    parameters: {
      type: 'object',
      properties: {
        student_ids: { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: { type: 'string' }, description: `학생 ID 목록 (최대 ${LMS.AGENT_BATCH_MAX}명)` },
        status: { type: 'string', enum: LMS.STUDENT_STATUS, description: '바꿀 상태' }
      },
      required: ['student_ids', 'status']
    }
  },
  {
    name: 'promote_grades',
    progress: '학년 올림 준비 중',
    description: '새 학년도에 재원생 전체의 학년을 한 단계씩 올립니다(초6→중1, 중3→고1 등, 고3·기타는 그대로). 실행할 때마다 다시 올라가므로 한 해에 한 번만, 강사가 분명히 요청했을 때만 씁니다.',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'assign_student_to_class',
    progress: '반 배정 준비 중',
    description: '학생을 반에 추가로 배정합니다(기존 반은 그대로). 반을 옮기려면 move_student를 씁니다. 학생은 search_students, 반은 list_classes로 찾습니다. 시험대비 반은 add_temp_assignment를 씁니다.',
    parameters: {
      type: 'object',
      properties: { student_id: STUDENT_ID, class_id: CLASS_ID, start_date: DATE('반 시작일') },
      required: ['student_id', 'class_id', 'start_date']
    },
    destructive: false
  },
  {
    name: 'move_student',
    progress: '반 이동 준비 중',
    description: '학생을 다른 반으로 옮깁니다. 지금 반은 이동일 전날로 끝나고, 새 반 배정이 이동일부터 시작됩니다. 두 반 이상 다니면 from_class_id로 떠날 반을 정합니다(get_student_profile의 classes).',
    parameters: {
      type: 'object',
      properties: {
        student_id: STUDENT_ID,
        class_id: { ...CLASS_ID, description: '옮겨 갈 반 ID (list_classes로 찾음)' },
        start_date: DATE('이동일 (새 반 첫날)'),
        from_class_id: { type: 'string', description: '떠날 반 ID (두 반 이상 다닐 때 필수)' }
      },
      required: ['student_id', 'class_id', 'start_date']
    }
  },
  {
    name: 'move_students',
    progress: '반 일괄 이동 준비 중',
    description: '한 반의 여러 학생을 다른 반으로 함께 옮깁니다. 한 명이라도 옮길 수 없으면 아무도 옮기지 않습니다. 학생 ID는 get_class_members로 찾습니다.',
    parameters: {
      type: 'object',
      properties: {
        from_class_id: { ...CLASS_ID, description: '지금 반 ID' },
        to_class_id: { ...CLASS_ID, description: '옮겨 갈 반 ID' },
        student_ids: { type: 'array', maxItems: LMS.AGENT_BATCH_MAX, items: { type: 'string' }, description: `옮길 학생 ID 목록 (최대 ${LMS.AGENT_BATCH_MAX}명)` },
        date: DATE('이동일 (새 반 첫날)')
      },
      required: ['from_class_id', 'to_class_id', 'student_ids', 'date']
    }
  },
  {
    name: 'close_student_class',
    progress: '반에서 빼기 준비 중',
    description: '학생을 반에서 뺍니다. 배정은 마지막 수업일까지로 끝나고 기록은 남습니다. rel_id 또는 student_id+class_id로 배정을 고릅니다.',
    parameters: {
      type: 'object',
      properties: { rel_id: REL_ID, student_id: REL_STUDENT, class_id: REL_CLASS, end_date: DATE('마지막 수업일') },
      required: ['end_date']
    }
  },
  {
    name: 'remove_student_class',
    progress: '반 배정 삭제 준비 중',
    description: '잘못 넣은 반 배정을 지웁니다. 그 반에 이 학생의 수업 기록이나 숙제 체크가 있으면 지울 수 없으니 close_student_class를 씁니다. rel_id 또는 student_id+class_id로 배정을 고릅니다.',
    parameters: {
      type: 'object',
      properties: { rel_id: REL_ID, student_id: REL_STUDENT, class_id: REL_CLASS }
    }
  },
  {
    name: 'update_student_class_start',
    progress: '반 시작일 변경 준비 중',
    description: '반 배정의 시작일을 고칩니다(예: 실제로는 더 일찍 들어온 학생). 이 반 첫 수업 기록보다 늦출 수는 없습니다. rel_id 또는 student_id+class_id로 배정을 고릅니다.',
    parameters: {
      type: 'object',
      properties: { rel_id: REL_ID, student_id: REL_STUDENT, class_id: REL_CLASS, start_date: DATE('새 시작일') },
      required: ['start_date']
    }
  },
  {
    name: 'add_temp_assignment',
    progress: '시험대비 배정 준비 중',
    description: '재원생을 시험대비 반에 임시 배정합니다. 그 기간에는 원래 반 수업에서 빠집니다. 시험대비 반은 list_classes(class_type 시험대비)로 찾고, 날짜를 비우면 시험대비 기간 전체입니다.',
    parameters: {
      type: 'object',
      properties: {
        class_id: { ...CLASS_ID, description: '시험대비 반 ID' },
        student_id: STUDENT_ID,
        start_date: DATE('시작일 (선택)'),
        end_date: DATE('종료일 (선택)'),
        source_class_id: { type: 'string', description: '빠지는 원래 반 ID (선택, 비우면 다니는 정규 반)' }
      },
      required: ['class_id', 'student_id']
    },
    destructive: false
  },
  {
    name: 'end_temp_assignment',
    progress: '조기 복귀 준비 중',
    description: '시험대비 임시 배정을 일찍 끝냅니다(조기 복귀). date가 시험대비 반의 마지막 수업일이 됩니다. rel_id 또는 student_id+class_id(시험대비 반)로 배정을 고릅니다.',
    parameters: {
      type: 'object',
      properties: { rel_id: REL_ID, student_id: REL_STUDENT, class_id: { ...REL_CLASS, description: '시험대비 반 ID (rel_id 대신 student_id와 함께 사용)' }, date: DATE('시험대비 반 마지막 수업일') },
      required: ['date']
    }
  }
];
