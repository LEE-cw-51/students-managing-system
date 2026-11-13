// MCP-only read tools. Entries: { name, progress, description, parameters, call(api, args) }.
import { LMS, str, pick, CLASS_ID, DATE, MONTH } from './shared.js';

const EVENT_LIMIT = 80;

export const READ_SCHEDULE_TOOLS = [
  {
    name: 'get_calendar',
    progress: '일정 확인 중',
    description: '기간 안의 수업 일정: 정규·시험대비 수업과 반·개인 보강(makeup_id). 휴강·시험대비 휴강일은 빠집니다. 한 달 이내로 조회하세요.',
    parameters: {
      type: 'object',
      properties: { start_date: DATE('시작일'), end_date: DATE('종료일') },
      required: ['start_date', 'end_date']
    },
    call(api, args) {
      const c = api.getCalendar(str(args.start_date), str(args.end_date));
      return {
        start: c.start,
        end: c.end,
        count: c.events.length,
        events: c.events.slice(0, EVENT_LIMIT).map((e) => pick(e, [
          'date', 'start_time', 'end_time', 'event_type', 'class_id', 'class_name', 'student_name', 'title', 'makeup_id', 'status'
        ])),
        truncated: c.events.length > EVENT_LIMIT
      };
    }
  },
  {
    name: 'get_day_agenda',
    progress: '하루 일정 확인 중',
    description: '그날 마감인 할 일 목록(task_id). 수업·보강은 get_today_board, 주의 학생은 get_learning_alerts에서 봅니다. 날짜를 비우면 오늘.',
    parameters: { type: 'object', properties: { date: DATE('날짜') } },
    call(api, args) {
      const a = api.getDayAgenda(str(args.date) || undefined);
      return {
        date: a.date,
        items: (a.items || []).slice(0, 40).map((i) => pick(i, [
          'kind', 'source', 'title', 'status', 'task_id', 'student_id', 'student_name', 'class_id', 'class_name', 'memo'
        ]))
      };
    }
  },
  {
    name: 'get_makeup_session',
    progress: '보강 확인 중',
    description: '보강 일정 하나(날짜·시간·반 또는 학생·상태·메모). makeup_id는 get_calendar에서 찾습니다.',
    parameters: {
      type: 'object',
      properties: { makeup_id: { type: 'string', description: '보강 ID (예: MKP_000001)' } },
      required: ['makeup_id']
    },
    call(api, args) {
      return pick(api.getMakeupSession(str(args.makeup_id)), [
        'makeup_id', 'makeup_date', 'start_time', 'end_time', 'kind', 'class_id', 'student_id', 'title', 'memo', 'status'
      ]);
    }
  },
  {
    name: 'get_class_session',
    progress: '수업 기록 확인 중',
    description: '반의 한 수업일 공통 기록: 진도, 수업 내용, 테스트 제목·범위·만점·난이도, 반 공지. 기록이 없으면 빈 값입니다.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID, date: DATE('수업일') }, required: ['class_id', 'date'] },
    call(api, args) {
      return pick(api.getClassSession(str(args.date), str(args.class_id)), [
        'session_id', 'lesson_date', 'class_id', 'progress', 'content', 'test_title', 'test_scope', 'test_max_score', 'test_difficulty', 'class_notice', 'memo'
      ]);
    }
  },
  {
    name: 'get_class_plans',
    progress: '강의 계획 확인 중',
    description: '강의 계획 목록(plan_id, 일간·주간·월간, 기간 키, 제목·목표·내용·숙제, 진행 상태). 반·종류·기간으로 거릅니다. 최신순 30개.',
    parameters: {
      type: 'object',
      properties: {
        class_id: CLASS_ID,
        period_type: { type: 'string', enum: LMS.PLAN_PERIOD, description: '계획 종류' },
        start_date: DATE('시작일'),
        end_date: DATE('종료일')
      }
    },
    call(api, args) {
      const rows = api.getClassPlans({
        class_id: str(args.class_id),
        period_type: str(args.period_type),
        start: str(args.start_date),
        end: str(args.end_date)
      });
      return {
        count: rows.length,
        plans: rows.slice(0, 30).map((p) => pick(p, [
          'plan_id', 'class_id', 'class_name', 'period_type', 'period_key', 'title', 'objectives', 'content', 'homework', 'done_status'
        ])),
        truncated: rows.length > 30
      };
    }
  },
  {
    name: 'get_plan_board',
    progress: '진도 계획표 확인 중',
    description: '반의 한 달 진도 계획표: 수업일별 상태(수업·보강·휴강), 기록된 진도, 일간 계획(plan_id), 단원별 진행, 주별 요약, 경고.',
    parameters: { type: 'object', properties: { class_id: CLASS_ID, month: MONTH('월') }, required: ['class_id', 'month'] },
    call(api, args) {
      const b = api.getPlanBoard(str(args.class_id), str(args.month));
      return {
        class: b.class,
        month: b.month,
        month_plan: b.month_plan ? pick(b.month_plan, ['plan_id', 'title', 'objectives', 'content']) : null,
        days: b.days.map((d) => ({
          ...pick(d, ['date', 'weekday', 'status', 'cancel_reason', 'suspension_title', 'progress']),
          recorded: d.recorded,
          plan: d.plan ? pick(d.plan, ['plan_id', 'title', 'content', 'done_status']) : null
        })),
        units: (b.curriculum || []).filter((u) => !u.complete || u.planned_this_month).slice(0, 20)
          .map((u) => pick(u, ['unit_id', 'title', 'sessions', 'done', 'planned_this_month'])),
        weeks: (b.weeks || []).map((w) => pick(w, ['week_start', 'summary', 'note'])),
        carry_over: b.carry_over,
        warnings: (b.warnings || []).map((w) => w.message),
        has_draft: Boolean(b.draft)
      };
    }
  }
];
