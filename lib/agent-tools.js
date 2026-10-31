import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LMS = require('../src/01_Service.js');

// Tool results go back to the model; long ones are cut so one call cannot fill the context.
export const TOOL_RESULT_MAX_CHARS = 6000;

const str = (v) => (v === null || v === undefined ? '' : String(v));
const pick = (obj, keys) => {
  const out = {};
  keys.forEach((k) => {
    if (obj && obj[k] !== undefined && obj[k] !== '' && obj[k] !== null) out[k] = obj[k];
  });
  return out;
};
const badgeLabels = (badges) => (Array.isArray(badges) ? badges.map((b) => b && (b.label || b.text)).filter(Boolean) : []);

const STUDENT_ID = { type: 'string', description: '학생 ID (예: STU-0001). search_students로 먼저 찾습니다.' };
const DATE = (what) => ({ type: 'string', description: `${what} (YYYY-MM-DD)` });

/**
 * Read tools run at once inside a short transaction. call(api, args) returns a compact,
 * model-friendly result built from existing view functions.
 */
const READ_TOOLS = [
  {
    name: 'search_students',
    description: '이름·학교·전화번호 일부로 학생을 찾습니다. 학생을 가리키는 모든 요청의 첫 단계입니다. 기본은 재원생만 찾습니다.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '이름(성 생략 가능)·학교·전화 뒷자리. 비우면 전체' },
        include_inactive: { type: 'boolean', description: '휴원·퇴원 학생도 포함' }
      }
    },
    call(api, args) {
      const rows = api.getStudentList({ query: str(args.query), status: args.include_inactive ? '' : '재원' });
      return {
        count: rows.length,
        students: rows.slice(0, 20).map((s) => ({
          student_id: s.student_id,
          name: s.name,
          grade: s.grade,
          school: s.school,
          status: s.status,
          classes: (s.classes || []).map((c) => c.class_name),
          last_lesson_date: s.last_lesson_date,
          badges: badgeLabels(s.badges)
        })),
        truncated: rows.length > 20
      };
    }
  },
  {
    name: 'get_student_profile',
    description: '학생 개요: 다니는 반, 다음 수업, 이번 달 출석률·숙제 이행률·시험 평균, 경고 배지, 다가오는 학교 시험, 최근 특이사항, 최근 상담, 예정된 할 일(task_id 포함).',
    parameters: { type: 'object', properties: { student_id: STUDENT_ID }, required: ['student_id'] },
    call(api, args) {
      const o = api.getStudentOverview(str(args.student_id));
      return {
        student: pick(o.student, ['student_id', 'name', 'grade', 'school', 'status', 'enrollment_date', 'memo']),
        today: o.today,
        classes: (o.classes || []).map((c) => ({ class_id: c.class_id, class_name: c.class_name, schedule: c.schedule_label })),
        next_class: o.next ? { class_name: o.next.class_name, date: o.next.date } : null,
        month: o.month,
        badges: badgeLabels(o.badges),
        exams: (o.exams || []).slice(0, 3),
        recent_notes: o.recent_notes,
        recent_counseling: (o.counseling || []).map((n) => pick(n, ['note_id', 'counsel_date', 'kind', 'title', 'content'])),
        open_tasks: (o.open_tasks || []).map((t) => pick(t, ['task_id', 'title', 'kind', 'due_date', 'status']))
      };
    }
  },
  {
    name: 'get_attendance',
    description: '학생의 한 달 출결 달력. 수업 기록이 있는 날은 lesson_id가 있고(출결 변경에 사용), 기록이 없는 수업일은 missing, 앞으로의 수업은 scheduled입니다.',
    parameters: {
      type: 'object',
      properties: { student_id: STUDENT_ID, month: { type: 'string', description: '월 (YYYY-MM)' } },
      required: ['student_id', 'month']
    },
    call(api, args) {
      const m = api.getStudentAttendanceMonth(str(args.student_id), str(args.month));
      return {
        month: m.month,
        counts: m.counts,
        attendance_rate: m.attendance_rate,
        days: m.days.filter((d) => d.entries.length).map((d) => ({
          date: d.date,
          weekday: d.weekday,
          entries: d.entries.map((e) => pick(e, ['kind', 'lesson_id', 'class_name', 'test', 'assignment', 'special_note', 'title']))
        }))
      };
    }
  },
  {
    name: 'get_student_lessons',
    description: '학생의 수업 기록(날짜·반·출결·테스트·과제 등급·특이사항, lesson_id). 기간을 비우면 최근 기록부터 30개.',
    parameters: {
      type: 'object',
      properties: { student_id: STUDENT_ID, start_date: DATE('시작일'), end_date: DATE('종료일') },
      required: ['student_id']
    },
    call(api, args) {
      const rows = api.getStudentLessons(str(args.student_id), str(args.start_date), str(args.end_date))
        .sort((a, b) => str(b.lesson_date).localeCompare(str(a.lesson_date)));
      return {
        count: rows.length,
        lessons: rows.slice(0, 30).map((l) => pick(l, [
          'lesson_id', 'lesson_date', 'class_id', 'attendance', 'test_status', 'test_score', 'test_max_score',
          'assignment_completion', 'progress', 'special_note'
        ]))
      };
    }
  },
  {
    name: 'get_scores',
    description: '학생의 테스트 성적(점수·만점·100점 환산·반 평균·등수)과 평균. 기간을 비우면 최근 6개월.',
    parameters: {
      type: 'object',
      properties: { student_id: STUDENT_ID, start_date: DATE('시작일'), end_date: DATE('종료일') },
      required: ['student_id']
    },
    call(api, args) {
      const g = api.getStudentGrades(str(args.student_id), { start: str(args.start_date), end: str(args.end_date) });
      return {
        start: g.start,
        end: g.end,
        stats: g.stats,
        tests: g.rows.slice(0, 20).map((r) => pick(r, ['date', 'class_name', 'title', 'scope', 'score', 'max_score', 'score_100', 'class_average', 'rank', 'taken']))
      };
    }
  },
  {
    name: 'get_homework_status',
    description: '학생의 숙제 항목별 이행 등급(A–F, 미확인), 이행률, 미흡 항목. 기간을 비우면 최근 6주.',
    parameters: {
      type: 'object',
      properties: { student_id: STUDENT_ID, start_date: DATE('시작일'), end_date: DATE('종료일') },
      required: ['student_id']
    },
    call(api, args) {
      const h = api.getStudentHomework(str(args.student_id), { start: str(args.start_date), end: str(args.end_date) });
      return {
        start: h.start,
        end: h.end,
        rate: h.rate,
        missing: h.missing,
        recent: h.rows.slice(0, 10).map((r) => ({
          date: r.date,
          class_name: r.class_name,
          items: r.items.map((it) => ({ title: it.title, status: it.status }))
        }))
      };
    }
  },
  {
    name: 'get_counseling_notes',
    description: '학생의 상담 기록(최근 10개)과 후속 조치 상태.',
    parameters: { type: 'object', properties: { student_id: STUDENT_ID }, required: ['student_id'] },
    call(api, args) {
      return api.getCounselingNotes(str(args.student_id)).slice(0, 10).map((n) => pick(n, [
        'note_id', 'counsel_date', 'kind', 'title', 'content', 'follow_up_date', 'follow_up_title', 'follow_up_status'
      ]));
    }
  },
  {
    name: 'get_today_board',
    description: '하루 현황: 그날 수업 반(기록 인원), 휴강, 보강, 할 일, 지난 할 일, 주의 학생, 이번 주 숙제 미완료 학생. 날짜를 비우면 오늘.',
    parameters: { type: 'object', properties: { date: DATE('날짜') } },
    call(api, args) {
      const b = api.getTodayBoard(str(args.date));
      return {
        date: b.date,
        today: b.today,
        classes: (b.classes || []).map((c) => pick(c, ['class_id', 'class_name', 'start_time', 'end_time', 'student_count', 'recorded_count', 'status'])),
        cancelled: (b.cancelled || []).map((c) => pick(c, ['class_name', 'reason'])),
        suspended: (b.suspended || []).map((c) => pick(c, ['class_name', 'period_title'])),
        makeups: (b.makeups || []).map((m) => pick(m, ['title', 'class_name', 'start_time', 'status'])),
        tasks: (b.tasks || []).map((t) => pick(t, ['task_id', 'title', 'kind', 'status', 'student_name', 'due_date'])),
        overdue_tasks: (b.overdue_tasks || []).map((t) => pick(t, ['task_id', 'title', 'status', 'student_name', 'due_date'])),
        flagged_students: (b.flagged || []).map((f) => ({ student_id: f.student_id, name: f.name, badges: badgeLabels(f.badges) })),
        weekly_homework: b.weekly_homework
      };
    }
  },
  {
    name: 'list_classes',
    description: '반 목록(class_id, 이름, 학년, 시간표, 현재 진도). 기본은 운영 중인 반만.',
    parameters: { type: 'object', properties: { include_closed: { type: 'boolean', description: '종료된 반도 포함' } } },
    call(api, args) {
      return api.getClassList({ status: args.include_closed ? '' : '운영' }).map((c) => pick(c, [
        'class_id', 'class_name', 'grade', 'class_type', 'schedule_label', 'current_progress', 'student_count', 'status'
      ]));
    }
  },
  {
    name: 'get_class_members',
    description: '반의 현재 학생 명단(student_id, 이름, 학교, 다른 반).',
    parameters: { type: 'object', properties: { class_id: { type: 'string', description: '반 ID (list_classes로 찾음)' } }, required: ['class_id'] },
    call(api, args) {
      const m = api.getClassMembers(str(args.class_id));
      return {
        class_name: m.class_name,
        students: m.current.map((s) => ({ student_id: s.student_id, name: s.name, grade: s.grade, school: s.school, other_classes: s.other_classes, away: Boolean(s.away) }))
      };
    }
  }
];

/**
 * Write tools never run during the chat. Their arguments are checked by the matching
 * LMS.AGENT_WRITE_ACTIONS preview and saved as a proposal the teacher approves.
 */
const WRITE_TOOLS = [
  {
    name: 'update_attendance',
    description: '[승인 필요] 이미 기록된 수업의 출결을 바꿉니다. lesson_id는 get_attendance 또는 get_student_lessons에서 찾습니다. 그날 수업 기록이 없으면 쓸 수 없으니, 수업 기록 화면에서 먼저 기록하도록 안내합니다.',
    parameters: {
      type: 'object',
      properties: {
        lesson_id: { type: 'string', description: '수업 기록 ID (예: LES-0012)' },
        attendance: { type: 'string', enum: LMS.ATTENDANCE, description: '출석 또는 결석' }
      },
      required: ['lesson_id', 'attendance']
    }
  },
  {
    name: 'create_counseling',
    description: '[승인 필요] 학생 상담 기록을 추가합니다. 후속 조치 날짜를 넣으면 그날 할 일이 함께 생깁니다.',
    parameters: {
      type: 'object',
      properties: {
        student_id: STUDENT_ID,
        kind: { type: 'string', enum: LMS.COUNSEL_KIND, description: '상담 대상: 학생 또는 학부모' },
        counsel_date: DATE('상담일'),
        title: { type: 'string', description: '짧은 제목' },
        content: { type: 'string', description: '상담 내용 (강사가 말한 내용을 그대로 정리)' },
        follow_up_date: DATE('후속 조치 날짜 (선택)'),
        follow_up_title: { type: 'string', description: '후속 조치 내용 (선택)' }
      },
      required: ['student_id', 'kind', 'counsel_date', 'content']
    }
  },
  {
    name: 'update_task_status',
    description: '[승인 필요] 할 일의 상태를 바꿉니다(완료 처리 등). task_id는 get_student_profile 또는 get_today_board에서 찾습니다.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '할 일 ID (예: TSK-0003)' },
        status: { type: 'string', enum: LMS.TASK_STATUS, description: '예정, 완료, 취소' }
      },
      required: ['task_id', 'status']
    }
  }
];

export const AGENT_TOOLS = [
  ...READ_TOOLS.map((t) => ({ ...t, kind: 'read' })),
  ...WRITE_TOOLS.map((t) => ({ ...t, kind: 'write' }))
];

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function getAgentTool(name) {
  return BY_NAME.get(name) || null;
}

/** Tool definitions in the OpenAI-compatible `tools` format. */
export function toolDefinitions() {
  return AGENT_TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));
}

/** JSON text for a tool result, cut to TOOL_RESULT_MAX_CHARS. */
export function toolResultText(value) {
  const text = JSON.stringify(value === undefined ? null : value);
  if (text.length <= TOOL_RESULT_MAX_CHARS) return text;
  return text.slice(0, TOOL_RESULT_MAX_CHARS) + '…(잘림: 기간이나 대상을 좁혀 다시 조회하세요)';
}
