import { LMS } from './lms.js';
import { str, pick, badgeLabels, STUDENT_ID, DATE } from './mcp-tools/shared.js';
import { MCP_READ_TOOLS } from './mcp-tools/index.js';
import { writePolicy } from './write-policy.js';

// Tool results go back to the model; long ones are cut so one call cannot fill the context.
export const TOOL_RESULT_MAX_CHARS = 6000;

/**
 * Read tools run at once inside a short transaction. call(api, args) returns a compact,
 * model-friendly result built from existing view functions. `progress` is the step label
 * the chat panel shows while the tool runs; it ends in " 중", which the panel drops once done.
 */
const READ_TOOLS = [
  {
    name: 'search_students',
    progress: '학생 검색 중',
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
    progress: '학생 정보 확인 중',
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
    progress: '출결 확인 중',
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
    progress: '수업 기록 확인 중',
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
    progress: '성적 확인 중',
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
    progress: '숙제 확인 중',
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
    progress: '상담 기록 확인 중',
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
    progress: '하루 현황 확인 중',
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
    progress: '반 목록 확인 중',
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
    progress: '반 명단 확인 중',
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
 * Write tools never run during the chat: each is a write action (src/08_AgentActions.js) whose
 * preview checks the arguments before they are saved as a proposal the teacher approves.
 */
const WRITE_TOOLS = LMS.agentActions.list().map((a) => ({
  name: a.name,
  progress: a.progress,
  description: a.description,
  parameters: a.parameters,
  destructive: a.destructive,
  kind: 'write',
  surfaces: a.surfaces
}));
const sharedWrite = (t) => t.surfaces.includes('assistant');

// surfaces: where a tool is offered, the in-app assistant and/or the Claude connector (MCP).
const BOTH = ['assistant', 'mcp'];
const MCP_ONLY = ['mcp'];

/** Every tool (assistant and MCP-only). The in-app assistant uses assistantTools(). */
export const AGENT_TOOLS = [
  ...READ_TOOLS.map((t) => ({ ...t, kind: 'read', surfaces: BOTH })),
  ...WRITE_TOOLS.filter(sharedWrite),
  ...MCP_READ_TOOLS.map((t) => ({ ...t, kind: 'read', surfaces: MCP_ONLY })),
  ...WRITE_TOOLS.filter((t) => !sharedWrite(t))
];

const BY_NAME = new Map();
AGENT_TOOLS.forEach((t) => {
  if (BY_NAME.has(t.name)) throw new Error('Duplicate agent tool: ' + t.name);
  if (t.kind !== 'write' && typeof t.call !== 'function') throw new Error('Tool without call(): ' + t.name);
  BY_NAME.set(t.name, t);
});

const onSurface = (surface) => AGENT_TOOLS.filter((t) => t.surfaces.includes(surface));
// Reads first, then writes, so Claude sees the lookup tools before the ones that change data.
const MCP_TOOLS = ['read', 'write'].flatMap((kind) => onSurface('mcp').filter((t) => t.kind === kind));
const SURFACE_TOOLS = { assistant: onSurface('assistant'), mcp: MCP_TOOLS };

/**
 * Tools a surface offers its model in a write mode, with the descriptions the write policy
 * gives them (writePolicy: 'assistant' has no mode, 'mcp' takes any stored value).
 */
export function offeredTools(surface, mode) {
  const policy = writePolicy(surface, mode);
  return SURFACE_TOOLS[surface].filter(policy.offers).map((t) => ({ ...t, description: policy.describe(t) }));
}

const ASSISTANT_TOOLS = offeredTools('assistant');

/** Tools the in-app AI assistant offers to its model. */
export function assistantTools() {
  return ASSISTANT_TOOLS;
}

/** Every tool on the Claude connector (MCP) surface, whatever the mode; listTools filters by mode. */
export function mcpTools() {
  return MCP_TOOLS;
}

/** Any tool by name, whatever its surface; callers check t.surfaces. */
export function getAgentTool(name) {
  return BY_NAME.get(name) || null;
}

/** Assistant tool definitions in the OpenAI-compatible `tools` format. */
export function toolDefinitions() {
  return ASSISTANT_TOOLS.map((t) => ({
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
