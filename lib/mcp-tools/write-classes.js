// MCP-only write tools. Entries: { name, progress, description, parameters, destructive? }.
// Each name needs a matching action in src/agent-actions/ (LMS.AGENT_WRITE_ACTIONS).
import { LMS, CLASS_ID, DATE } from './shared.js';

const CLASS_FIELDS = {
  class_name: { type: 'string', description: '반 이름 (예: 중2 A반)' },
  grade: { type: 'string', enum: LMS.GRADE_OPTIONS, description: '학년' },
  school_year: { type: 'string', description: '학년도 (예: 2026)' },
  semester: { type: 'string', enum: ['1', '2'], description: '학기' },
  teacher: { type: 'string', description: '담당 강사' },
  textbook: { type: 'string', description: '교재' },
  weekday: { type: 'string', description: '수업 요일, /로 구분 (예: 월/수)' },
  start_time: { type: 'string', description: '시작 시간 (HH:MM)' },
  end_time: { type: 'string', description: '종료 시간 (HH:MM)' },
  memo: { type: 'string', description: '메모' }
};

export const WRITE_CLASS_TOOLS = [
  {
    name: 'create_class',
    progress: '반 추가 준비 중',
    description: '새 정규 반을 만듭니다(운영 상태). 요일과 시간은 weekday(예: 월/수)와 start_time, end_time으로 넣습니다. 같은 이름 반이 있는지 list_classes로 먼저 확인합니다. 시험대비 반은 시험 화면에서 만듭니다.',
    parameters: { type: 'object', properties: CLASS_FIELDS, required: ['class_name', 'weekday', 'start_time', 'end_time'] },
    destructive: false
  },
  {
    name: 'update_class',
    progress: '반 정보 수정 준비 중',
    description: '반 정보(이름·학년·담당·교재·요일·시간·현재 진도·기본 숙제·메모)를 고칩니다. 바꿀 항목만 넣습니다. ' +
      '시간표는 요일마다 시간이 따로 저장됩니다. weekday만 바꾸면 남는 요일은 원래 시간을 그대로 두고, start_time·end_time은 모든 요일 시간이 같은 반에서만 쓸 수 있습니다. ' +
      '요일마다 시간이 다른 반(예: 화 18:00-20:00, 목 19:00-21:00)의 시간을 바꾸거나 새 요일을 더할 때는 schedule에 모든 요일의 시간을 넣습니다(weekday·시간 대신). ' +
      '반 종료는 close_class를 씁니다. class_id는 list_classes로 찾습니다.',
    parameters: {
      type: 'object',
      properties: {
        class_id: CLASS_ID,
        ...CLASS_FIELDS,
        schedule: {
          type: 'array',
          description: '요일별 시간표 전체 (넣으면 weekday·start_time·end_time 대신 이것으로 바꿈)',
          items: {
            type: 'object',
            properties: {
              day: { type: 'string', enum: LMS.WEEKDAYS, description: '요일' },
              start: { type: 'string', description: '시작 시간 (HH:MM)' },
              end: { type: 'string', description: '종료 시간 (HH:MM)' }
            },
            required: ['day', 'start', 'end']
          }
        },
        textbook_started_on: DATE('새 교재 시작일 (교재를 바꿀 때, 선택)'),
        current_progress: { type: 'string', description: '현재 진도' },
        class_homework: { type: 'string', description: '기본 숙제' }
      },
      required: ['class_id']
    }
  },
  {
    name: 'close_class',
    progress: '반 종료 준비 중',
    description: '반을 종료합니다. 정규 반이면 현재 배정된 학생들의 배정이 모두 끝나고, 수업 기록은 남습니다. class_id는 list_classes로 찾습니다.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID }, required: ['class_id'] }
  },
  {
    name: 'delete_class',
    progress: '반 삭제 준비 중',
    description: '잘못 만든 반을 지웁니다. 학생 배정·진도 계획·숙제 항목·보강도 함께 지워지고 되돌릴 수 없습니다. 수업 기록이나 숙제 체크가 있는 반은 지울 수 없으니 close_class를 씁니다. 실행 전 영향 범위를 강사에게 확인합니다.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID }, required: ['class_id'] }
  },
  {
    name: 'cancel_class_date',
    progress: '휴강 지정 준비 중',
    description: '반의 하루 수업을 휴강으로 지정합니다. 그 반의 수업일이어야 하고, 이미 수업 기록이 있는 날은 안 됩니다. class_id는 list_classes, 수업일은 get_today_board로 확인합니다.',
    parameters: {
      type: 'object',
      properties: { class_id: CLASS_ID, date: DATE('휴강할 날짜'), reason: { type: 'string', description: '사유 (선택)' } },
      required: ['class_id', 'date']
    }
  }
];
