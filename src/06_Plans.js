/**
 * Class lesson planning: month → week → day plans linked by date, built from the class
 * curriculum (units in order) and the real meeting dates. Drafts (basic split or AI) live in
 * PlanDrafts until the teacher confirms items into ClassPlans, so other screens only ever
 * see confirmed plans. Single-day cancellations live on the class row (cancel_dates).
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

// ----- Pure helpers -----

/** Monday keys of the weeks that overlap the month (YYYY-MM). */
LMS.planWeeksForMonth = function (month) {
  var parts = LMS.toStr(month).split('-');
  var range = LMS.monthRange(parts[0], parts[1]);
  var weeks = [];
  var cur = LMS.weekRange(range.start).start;
  while (cur <= range.end) {
    weeks.push(cur);
    cur = LMS.addDays(cur, 7);
  }
  return weeks;
};

/** Value a daily plan contributes to its units: 완료 1, 일부 0.5, 못 함 / blank 0. */
LMS.planDoneWeight = function (status) {
  var s = LMS.toStr(status);
  if (s === '완료') return 1;
  if (s === '일부') return 0.5;
  return 0;
};

/**
 * Remaining unit sessions in curriculum order, after `done` (unit_id → sessions done).
 * Each entry is one meeting's worth: { unit, index, total }.
 */
LMS.remainingUnitSessions = function (curriculum, done) {
  var queue = [];
  (curriculum || []).forEach(function (unit) {
    var total = unit.sessions;
    var used = done[unit.unit_id] || 0;
    var left = Math.max(0, Math.ceil(total - used - 1e-9));
    for (var i = total - left + 1; i <= total; i++) {
      queue.push({ unit: unit, index: i, total: total });
    }
  });
  return queue;
};

LMS.planSlotTitle = function (slot) {
  return slot.unit.title + (slot.total > 1 ? ' (' + slot.index + '/' + slot.total + ')' : '');
};

LMS.PLAN_REVIEW_TITLE = '복습 · 보충';

/** Lay the queue onto the dates in order; leftover units carry over to next month. */
LMS.assignUnitSessions = function (dates, queue) {
  var days = dates.map(function (date, i) {
    var slot = queue[i];
    if (!slot) {
      return {
        date: date,
        unit_ids: [],
        title: LMS.PLAN_REVIEW_TITLE,
        content: '계획한 단원을 마쳤습니다. 오답 정리와 심화 문제로 운영합니다.',
        homework: '',
        materials: ''
      };
    }
    return {
      date: date,
      unit_ids: [slot.unit.unit_id],
      title: LMS.planSlotTitle(slot),
      content: '',
      homework: '',
      materials: ''
    };
  });
  var carry = [];
  queue.slice(dates.length).forEach(function (slot) {
    if (carry.indexOf(slot.unit.unit_id) === -1) carry.push(slot.unit.unit_id);
  });
  return { days: days, carry_over: carry };
};

/** Unit titles of the ids in curriculum order (unknown ids are skipped). */
LMS.unitTitles = function (curriculum, unitIds) {
  var want = {};
  (unitIds || []).forEach(function (id) { want[LMS.toStr(id)] = true; });
  return (curriculum || []).filter(function (u) { return want[u.unit_id]; }).map(function (u) { return u.title; });
};

LMS.planFieldsEqual = function (a, b) {
  var keys = ['title', 'objectives', 'content', 'homework', 'materials'];
  for (var i = 0; i < keys.length; i++) {
    if (LMS.toStr(a[keys[i]]) !== LMS.toStr(b[keys[i]])) return false;
  }
  return LMS.jsonList(a.unit_ids).join(',') === LMS.jsonList(b.unit_ids).join(',');
};

/**
 * Compare a proposal with the confirmed plans.
 * Items: add (new), change (differs), same, locked (past or recorded day), remove (an existing
 * day plan on a date the class no longer meets). Hand-written plans default to "keep" unless the
 * teacher edited that draft item, which means they already chose it.
 */
LMS.diffPlanProposal = function (existing, proposal, options) {
  options = options || {};
  var locked = options.locked || {};
  var byKey = {};
  (existing || []).forEach(function (p) { byKey[p.period_type + '|' + p.period_key] = p; });
  var items = [];
  var push = function (type, key, proposed) {
    var current = byKey[type + '|' + key] || null;
    var item = { key: type + '|' + key, period_type: type, period_key: key, current: current, proposed: proposed, edited: !!proposed.edited };
    if (type === '일간' && locked[key]) {
      item.action = 'locked';
      item.selectable = false;
      item.selected = false;
    } else if (!current) {
      item.action = 'add';
      item.selectable = true;
      item.selected = true;
    } else if (LMS.planFieldsEqual(current, proposed)) {
      item.action = 'same';
      item.selectable = false;
      item.selected = false;
    } else {
      item.action = 'change';
      item.selectable = true;
      item.selected = item.edited || LMS.toStr(current.source) !== 'manual';
    }
    items.push(item);
  };
  if (proposal.month) push('월간', proposal.month.period_key, proposal.month);
  (proposal.days || []).forEach(function (d) { push('일간', d.period_key, d); });
  (options.orphans || []).forEach(function (p) {
    items.push({
      key: '일간|' + p.period_key, period_type: '일간', period_key: p.period_key,
      current: p, proposed: null, action: 'remove', selectable: true, selected: false
    });
  });
  return items;
};

LMS.SUGGESTION_TASK_KIND = { '상담': 'counsel_student', '보충과제': 'homework_check', '클리닉': 'other', '보강': 'other' };

/** First balanced {...} block in a model reply (code fences and chatter around it are ignored). */
LMS.extractJsonObject = function (text) {
  var raw = LMS.toStr(text).replace(/```(?:json)?/gi, '');
  var start = raw.indexOf('{');
  while (start !== -1) {
    var depth = 0;
    var inStr = false;
    var esc = false;
    for (var i = start; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            var parsed = JSON.parse(raw.slice(start, i + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
          } catch (e) {
            // try the next opening brace
          }
          break;
        }
      }
    }
    start = raw.indexOf('{', start + 1);
  }
  return null;
};

// ----- Service -----

LMS.createPlanner = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;
  var store = ctx.store;

  function today() {
    return store.today();
  }

  function assertMonth(month) {
    var m = LMS.toStr(month) || today().slice(0, 7);
    if (!LMS.isYearMonth(m)) throw new Error('월 형식이 올바르지 않습니다. YYYY-MM으로 입력해 주세요.');
    return m;
  }

  function monthRangeOf(month) {
    var parts = month.split('-');
    return LMS.monthRange(parts[0], parts[1]);
  }

  function classPlans(classId) {
    return table('ClassPlans').filter(function (p) { return LMS.toStr(p.class_id) === LMS.toStr(classId); });
  }

  /** Changes to the class row (curriculum, cancellations) or any of its plans move this. */
  function baseVersion(cls) {
    var plans = classPlans(cls.class_id);
    var max = LMS.toStr(cls.updated_at);
    plans.forEach(function (p) {
      if (LMS.toStr(p.updated_at) > max) max = LMS.toStr(p.updated_at);
    });
    return max + '|' + plans.length;
  }

  /** Dates with a saved class session or any student lesson for the class. */
  function recordedDates(classId) {
    var out = {};
    table('ClassSessions').forEach(function (r) {
      if (LMS.toStr(r.class_id) === LMS.toStr(classId)) out[LMS.toStr(r.lesson_date)] = true;
    });
    table('Lessons').forEach(function (r) {
      if (LMS.toStr(r.class_id) === LMS.toStr(classId)) out[LMS.toStr(r.lesson_date)] = true;
    });
    return out;
  }

  function classMakeupDates(classId, start, end) {
    var out = {};
    table('MakeupSessions').forEach(function (m) {
      if (LMS.toStr(m.kind) === '반' && LMS.toStr(m.class_id) === LMS.toStr(classId) &&
          LMS.toStr(m.status) !== '취소' && LMS.inRange(m.makeup_date, start, end)) {
        out[LMS.toStr(m.makeup_date)] = m;
      }
    });
    return out;
  }

  /** Every date the class meets in [start, end]: regular meetings plus whole-class makeups. */
  function meetingDates(cls, start, end) {
    var dates = {};
    LMS.classMeetingDatesFor(cls, start, end, ctx.examPeriods()).forEach(function (d) { dates[d] = true; });
    Object.keys(classMakeupDates(cls.class_id, start, end)).forEach(function (d) { dates[d] = true; });
    return Object.keys(dates).sort();
  }

  function planningSupport(cls) {
    if (LMS.toStr(cls.class_type) === '시험대비') {
      return { ok: false, reason: '시험대비 반은 자동 계획을 쓰지 않습니다. 계획을 직접 작성해 주세요.' };
    }
    if (!LMS.classCurriculum(cls).length) {
      return { ok: false, reason: '반 정보에서 교재·단원 목록을 먼저 입력해 주세요.' };
    }
    return { ok: true, reason: '' };
  }

  /**
   * The basic split for a month plus everything a draft or AI needs: which dates can change,
   * which are locked, the done count per unit, and the rebuilt month goal. Weeks are not
   * planned separately; the board summarizes each week from its day plans.
   */
  function computeProposal(cls, month) {
    var range = monthRangeOf(month);
    var now = today();
    var curriculum = LMS.classCurriculum(cls);
    var recorded = recordedDates(cls.class_id);
    var meets = meetingDates(cls, range.start, range.end);
    var editable = meets.filter(function (d) { return d >= now && !recorded[d]; });
    var editableSet = {};
    editable.forEach(function (d) { editableSet[d] = true; });
    var locked = {};
    var plans = classPlans(cls.class_id);
    var dailyByDate = {};
    plans.forEach(function (p) {
      if (LMS.toStr(p.period_type) === '일간') dailyByDate[LMS.toStr(p.period_key)] = p;
    });
    // Units are done by past or recorded days; earlier months' upcoming days count as planned.
    var done = {};
    Object.keys(dailyByDate).forEach(function (d) {
      var p = dailyByDate[d];
      var units = LMS.jsonList(p.unit_ids);
      if (!units.length || editableSet[d] || d > range.end) return;
      var weight;
      if (d < now || recorded[d]) {
        weight = LMS.planDoneWeight(LMS.toStr(p.done_status) || (recorded[d] ? '완료' : ''));
      } else if (d < range.start) {
        weight = 1;
      } else {
        return;
      }
      units.forEach(function (u) { done[u] = (done[u] || 0) + weight / units.length; });
    });
    curriculum.forEach(function (u) { if (u.completed) done[u.unit_id] = u.sessions; });
    meets.forEach(function (d) { if (!editableSet[d]) locked[d] = true; });
    var queue = LMS.remainingUnitSessions(curriculum, done);
    var split = LMS.assignUnitSessions(editable, queue);
    var days = split.days.map(function (d) {
      return Object.assign({ period_type: '일간', period_key: d.date, objectives: '' }, d);
    });
    var dayUnits = function (date) {
      var proposed = days.filter(function (x) { return x.date === date; })[0];
      if (proposed) return proposed.unit_ids;
      var p = dailyByDate[date];
      return p ? LMS.jsonList(p.unit_ids) : [];
    };
    var monthIds = [];
    LMS.datesInRange(range.start, range.end).forEach(function (d) {
      dayUnits(d).forEach(function (u) { if (monthIds.indexOf(u) === -1) monthIds.push(u); });
    });
    var monthTitles = LMS.unitTitles(curriculum, monthIds);
    var monthPlan = editable.length ? {
      period_type: '월간', period_key: month, unit_ids: monthIds,
      title: monthTitles.length ? (monthTitles.length > 1 ? monthTitles[0] + ' ~ ' + monthTitles[monthTitles.length - 1] : monthTitles[0]) : LMS.PLAN_REVIEW_TITLE,
      objectives: monthTitles.map(function (t) { return '- ' + t; }).join('\n'),
      content: '', homework: '', materials: ''
    } : null;
    var orphans = plans.filter(function (p) {
      var d = LMS.toStr(p.period_key);
      return LMS.toStr(p.period_type) === '일간' && LMS.inRange(d, range.start, range.end) &&
        d >= now && !recorded[d] && meets.indexOf(d) === -1;
    });
    return {
      month: month,
      range: range,
      curriculum: curriculum,
      done: done,
      queue: queue,
      meeting_dates: meets,
      editable: editable,
      locked: locked,
      recorded: recorded,
      proposal: { month: monthPlan, days: days, carry_over: split.carry_over, students: [] },
      orphans: orphans
    };
  }

  function monthPlans(cls, month) {
    var range = monthRangeOf(month);
    var weeks = LMS.planWeeksForMonth(month);
    return classPlans(cls.class_id).filter(function (p) {
      var type = LMS.toStr(p.period_type);
      var key = LMS.toStr(p.period_key);
      if (type === '월간') return key === month;
      if (type === '주간') return weeks.indexOf(key) !== -1;
      return LMS.inRange(key, range.start, range.end);
    });
  }

  function pendingDraft(classId, month) {
    return table('PlanDrafts').filter(function (d) {
      return LMS.toStr(d.class_id) === LMS.toStr(classId) && LMS.toStr(d.month) === month && LMS.toStr(d.status) === '대기';
    })[0] || null;
  }

  function draftPayload(draft) {
    if (!draft) return null;
    if (draft.payload && typeof draft.payload === 'object') return draft.payload;
    try {
      return JSON.parse(LMS.toStr(draft.payload));
    } catch (e) {
      return null;
    }
  }

  function slimPlan(p) {
    if (!p) return null;
    return {
      plan_id: p.plan_id, period_type: p.period_type, period_key: p.period_key,
      title: LMS.toStr(p.title), objectives: LMS.toStr(p.objectives), content: LMS.toStr(p.content),
      homework: LMS.toStr(p.homework), materials: LMS.toStr(p.materials), memo: LMS.toStr(p.memo),
      unit_ids: LMS.jsonList(p.unit_ids), source: LMS.toStr(p.source) || 'manual',
      rationale: LMS.toStr(p.rationale), done_status: LMS.toStr(p.done_status)
    };
  }

  /** Everything the plan screen shows for one class and month. */
  function getPlanBoard(classId, month) {
    var cls = ctx.requireClass(classId);
    month = assertMonth(month);
    var now = today();
    var range = monthRangeOf(month);
    var support = planningSupport(cls);
    var computed = computeProposal(cls, month);
    var curriculum = computed.curriculum;
    var plans = monthPlans(cls, month);
    var periods = ctx.examPeriods();
    var makeups = classMakeupDates(cls.class_id, range.start, range.end);
    var sessions = {};
    table('ClassSessions').forEach(function (r) {
      if (LMS.toStr(r.class_id) === LMS.toStr(classId) && LMS.inRange(r.lesson_date, range.start, range.end)) {
        sessions[LMS.toStr(r.lesson_date)] = r;
      }
    });
    var dailyByDate = {};
    plans.forEach(function (p) { if (LMS.toStr(p.period_type) === '일간') dailyByDate[LMS.toStr(p.period_key)] = p; });
    var warnings = [];
    var days = LMS.datesInRange(range.start, range.end).filter(function (d) {
      return LMS.classTimeOn(cls, d) || makeups[d] || dailyByDate[d] || computed.recorded[d];
    }).map(function (d) {
      var cancel = LMS.classCancellationOn(cls, d);
      var suspension = LMS.toStr(cls.class_type) === '시험대비' ? null : LMS.classSuspensionOn(cls, d, periods);
      var meets = computed.meeting_dates.indexOf(d) !== -1;
      var status = meets ? (makeups[d] ? 'makeup' : 'meets') : cancel ? 'cancelled' : suspension ? 'suspended' : 'none';
      var plan = dailyByDate[d] || null;
      var recorded = !!computed.recorded[d];
      if (plan && !meets && !recorded && d >= now) {
        warnings.push({ code: 'plan_on_off_day', date: d, message: LMS.formatKoreanDate(d) + '은 수업이 없는데 계획이 남아 있습니다.' });
      }
      var session = sessions[d];
      return {
        date: d,
        weekday: LMS.weekdayName(d),
        week_start: LMS.weekRange(d).start,
        status: status,
        cancel_reason: cancel ? LMS.toStr(cancel.reason) : '',
        suspension_title: suspension ? LMS.toStr(suspension.title) : '',
        recorded: recorded,
        locked: d < now || recorded,
        progress: session ? LMS.toStr(session.progress) : '',
        plan: slimPlan(plan)
      };
    });
    var behind = days.filter(function (d) {
      return d.plan && d.plan.unit_ids.length && d.locked && (d.plan.done_status === '일부' || d.plan.done_status === '못 함');
    });
    if (behind.length && computed.editable.length) {
      warnings.push({ code: 'behind', message: '진도가 계획보다 ' + behind.length + '회 밀렸습니다. 초안을 다시 만들면 남은 수업일에 다시 나눕니다.' });
    }
    var units = curriculum.map(function (u) {
      var planned = 0;
      Object.keys(dailyByDate).forEach(function (d) {
        var ids = LMS.jsonList(dailyByDate[d].unit_ids);
        if (ids.indexOf(u.unit_id) !== -1) planned += 1 / ids.length;
      });
      var doneCount = Math.round((computed.done[u.unit_id] || 0) * 10) / 10;
      return {
        unit_id: u.unit_id, textbook: u.textbook, title: u.title, sessions: u.sessions,
        done: Math.min(doneCount, u.sessions), planned_this_month: Math.round(planned * 10) / 10,
        complete: doneCount >= u.sessions - 1e-9
      };
    });
    if (support.ok && !units.some(function (u) { return u.done > 0; }) &&
        Object.keys(computed.recorded).some(function (d) { return d < now; })) {
      warnings.push({ code: 'no_start', message: '이미 나간 단원이 있다면 반 정보 수정의 단원 목록에서 ‘지금 나가는 단원’을 골라 주세요. 그 단원부터 계획합니다.' });
    }
    var draft = pendingDraft(classId, month);
    var payload = draftPayload(draft);
    var version = baseVersion(cls);
    var diff = payload ? LMS.diffPlanProposal(plans, payload, { locked: computed.locked, orphans: computed.orphans }) : [];
    var students = table('Students');
    var titleOf = function (ids) { return LMS.unitTitles(curriculum, ids); };
    return {
      class: { class_id: cls.class_id, class_name: cls.class_name, class_type: LMS.toStr(cls.class_type) || '정규', status: cls.status },
      month: month,
      today: now,
      base_version: version,
      support: support,
      curriculum: units,
      current_unit_id: computed.queue.length ? computed.queue[0].unit.unit_id : '',
      month_plan: slimPlan(plans.filter(function (p) { return p.period_type === '월간'; })[0]),
      // Week = summary of its day plans (units in order); an old hand-written week plan is shown as-is.
      weeks: LMS.planWeeksForMonth(month).map(function (w) {
        var ids = [];
        days.forEach(function (d) {
          if (d.week_start === w && d.plan) d.plan.unit_ids.forEach(function (u) { if (ids.indexOf(u) === -1) ids.push(u); });
        });
        var legacy = plans.filter(function (p) { return p.period_type === '주간' && p.period_key === w; })[0];
        return {
          week_start: w,
          week_end: LMS.addDays(w, 6),
          summary: titleOf(ids).join(' · '),
          note: legacy ? LMS.toStr(legacy.title || legacy.objectives) : ''
        };
      }),
      days: days,
      editable_count: computed.editable.length,
      carry_over: LMS.unitTitles(curriculum, computed.proposal.carry_over),
      warnings: warnings,
      draft: draft ? {
        draft_id: draft.draft_id,
        mode: draft.mode,
        model: LMS.toStr(draft.model),
        created_at: draft.created_at,
        stale: LMS.toStr(draft.base_version) !== version,
        rationale: payload ? LMS.toStr(payload.rationale) : '',
        carry_over: payload ? LMS.unitTitles(curriculum, payload.carry_over) : [],
        warnings: LMS.jsonList(draft.warnings),
        items: diff.map(function (it) {
          return {
            key: it.key, period_type: it.period_type, period_key: it.period_key, action: it.action,
            selectable: it.selectable, selected: it.selected, edited: it.edited,
            current: slimPlan(it.current), proposed: it.proposed
          };
        }),
        students: (payload && Array.isArray(payload.students) ? payload.students : []).map(function (st) {
          var row = LMS.findById(students, 'student_id', st.student_id);
          return Object.assign({}, st, { student_name: row ? row.name : '', selected: true });
        })
      } : null
    };
  }

  function writeDraft(cls, month, mode, payload, warnings, version, model) {
    var ts = ctx.now();
    var cutoff = LMS.addDays(today(), -30);
    // Finished drafts are only history; keep a month of it so the table stays small.
    var rows = table('PlanDrafts').filter(function (d) {
      return LMS.toStr(d.status) === '대기' || LMS.toStr(d.updated_at).slice(0, 10) >= cutoff;
    });
    rows.forEach(function (d) {
      if (LMS.toStr(d.class_id) === LMS.toStr(cls.class_id) && LMS.toStr(d.month) === month && LMS.toStr(d.status) === '대기') {
        d.status = '폐기';
        d.updated_at = ts;
      }
    });
    var row = {
      draft_id: ctx.nextIds(LMS.PREFIX.planDraft, 1)[0],
      class_id: cls.class_id,
      month: month,
      mode: mode,
      payload: payload,
      warnings: warnings || [],
      base_version: version,
      model: model || '',
      status: '대기',
      created_at: ts,
      updated_at: ts
    };
    rows.push(row);
    saveTable('PlanDrafts', rows);
    return row;
  }

  /** Draft the unit-order split (no AI) for the month; `note` says why AI was not used. */
  function createSplitDraft(classId, month, note) {
    return ctx.withLock(function () {
      var cls = ctx.requireClass(classId);
      month = assertMonth(month);
      var support = planningSupport(cls);
      if (!support.ok) throw new Error(support.reason);
      var computed = computeProposal(cls, month);
      if (!computed.editable.length) throw new Error('이 달에는 계획을 바꿀 수 있는 남은 수업일이 없습니다.');
      var payload = Object.assign({ rationale: '' }, computed.proposal);
      writeDraft(cls, month, 'split', payload, note ? [LMS.clipText(note, 300)] : [], baseVersion(cls), '');
      return getPlanBoard(classId, month);
    });
  }

  function discardPlanDraft(draftId) {
    return ctx.withLock(function () {
      var rows = table('PlanDrafts');
      var row = LMS.findById(rows, 'draft_id', draftId);
      if (!row) throw new Error('계획 초안을 찾을 수 없습니다.');
      if (LMS.toStr(row.status) === '대기') {
        row.status = '폐기';
        row.updated_at = ctx.now();
        saveTable('PlanDrafts', rows);
      }
      return getPlanBoard(row.class_id, row.month);
    });
  }

  /**
   * Confirm the chosen draft items into ClassPlans. `seen_version` is the board version the
   * teacher reviewed: if plans changed since then, nothing is written and the screen reloads.
   */
  function applyPlanDraft(data) {
    return ctx.withLock(function () {
      data = data || {};
      var rows = table('PlanDrafts');
      var draft = LMS.findById(rows, 'draft_id', data.draft_id);
      if (!draft) throw new Error('계획 초안을 찾을 수 없습니다.');
      if (LMS.toStr(draft.status) !== '대기') throw new Error('이미 처리된 초안입니다. 화면을 새로 고쳐 주세요.');
      var cls = ctx.requireClass(draft.class_id);
      if (LMS.toStr(data.seen_version) !== baseVersion(cls)) {
        throw new Error('확인하는 사이 계획이 바뀌었습니다. 바뀐 내용으로 다시 비교해 주세요.');
      }
      var keys = LMS.jsonList(data.keys).map(LMS.toStr);
      var studentKeys = LMS.jsonList(data.student_keys).map(LMS.toStr);
      if (!keys.length && !studentKeys.length) throw new Error('확정할 항목을 하나 이상 선택해 주세요.');
      var month = LMS.toStr(draft.month);
      var computed = computeProposal(cls, month);
      var payload = draftPayload(draft);
      if (!payload) throw new Error('초안 내용을 읽을 수 없습니다. 다시 만들어 주세요.');
      var items = LMS.diffPlanProposal(monthPlans(cls, month), payload, { locked: computed.locked, orphans: computed.orphans });
      var byKey = {};
      items.forEach(function (it) { byKey[it.key] = it; });
      var plans = table('ClassPlans');
      var ts = ctx.now();
      var source = LMS.toStr(draft.mode) === 'ai' ? 'ai' : 'split';
      var applied = 0;
      var removeIds = {};
      keys.forEach(function (key) {
        var it = byKey[key];
        if (!it || !it.selectable) return;
        if (it.action === 'remove') {
          removeIds[LMS.toStr(it.current.plan_id)] = true;
          applied += 1;
          return;
        }
        var p = it.proposed;
        var fields = {
          title: LMS.clipText(p.title, 200),
          objectives: LMS.clipText(p.objectives, 2000),
          content: LMS.clipText(p.content, 4000),
          homework: LMS.clipText(p.homework, 1000),
          materials: LMS.clipText(p.materials, 500),
          unit_ids: LMS.jsonList(p.unit_ids),
          // What the teacher edited is theirs: later drafts keep it unless they choose otherwise.
          source: p.edited ? 'manual' : source,
          rationale: it.period_type === '월간' ? LMS.clipText(payload.rationale, 2000) : LMS.clipText(p.rationale, 500),
          updated_at: ts
        };
        var row = it.current ? LMS.findById(plans, 'plan_id', it.current.plan_id) : null;
        if (row) {
          Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
        } else {
          plans.push(Object.assign({
            plan_id: ctx.nextIds(LMS.PREFIX.plan, 1)[0],
            class_id: cls.class_id,
            period_type: it.period_type,
            period_key: it.period_key,
            memo: '',
            done_status: '',
            created_at: ts
          }, fields));
        }
        applied += 1;
      });
      var tasks = 0;
      var studentList = Array.isArray(payload.students) ? payload.students : [];
      var due = meetingDates(cls, LMS.addDays(today(), 1), LMS.addDays(today(), 30))[0] || today();
      studentList.forEach(function (st) {
        if (studentKeys.indexOf(LMS.toStr(st.key)) === -1) return;
        ctx.saveTask({
          due_date: due,
          kind: LMS.SUGGESTION_TASK_KIND[st.kind] || 'other',
          title: (st.kind === '보강' ? '보강 일정 잡기: ' : '[' + st.kind + '] ') + LMS.toStr(st.title),
          memo: LMS.toStr(st.reason),
          student_id: st.student_id,
          class_id: cls.class_id
        });
        tasks += 1;
      });
      if (!applied && !tasks) throw new Error('확정할 수 있는 항목이 없습니다. 화면을 새로 고쳐 주세요.');
      saveTable('ClassPlans', plans.filter(function (p) { return !removeIds[LMS.toStr(p.plan_id)]; }));
      draft.status = '적용';
      draft.updated_at = ts;
      saveTable('PlanDrafts', rows);
      var board = getPlanBoard(cls.class_id, month);
      board.applied_count = applied;
      board.task_count = tasks;
      return board;
    });
  }

  // ----- AI context and draft -----

  function rate(done, total) {
    return total ? Math.round((done / total) * 100) : null;
  }

  /**
   * Input for the AI planner. Students are sent as S1, S2… (alias map stays on the server);
   * no phone numbers, memos or counseling text leave the server.
   */
  function getClassPlanContext(classId, month) {
    var cls = ctx.requireClass(classId);
    month = assertMonth(month);
    var support = planningSupport(cls);
    if (!support.ok) throw new Error(support.reason);
    var computed = computeProposal(cls, month);
    if (!computed.editable.length) throw new Error('이 달에는 계획을 바꿀 수 있는 남은 수업일이 없습니다.');
    var now = today();
    var since = LMS.addDays(now, -28);
    var roster = ctx.assignments.recordTargets(classId, now).students
      .sort(function (a, b) { return LMS.toStr(a.student_id).localeCompare(LMS.toStr(b.student_id)); });
    var aliases = {};
    var lessons = table('Lessons').filter(function (l) {
      return LMS.toStr(l.class_id) === LMS.toStr(classId) && LMS.inRange(l.lesson_date, since, now);
    });
    var items = table('HomeworkItems').filter(function (it) {
      return LMS.toStr(it.class_id) === LMS.toStr(classId) && LMS.inRange(it.lesson_date, since, now);
    });
    var itemIds = {};
    items.forEach(function (it) { itemIds[LMS.toStr(it.item_id)] = true; });
    var checks = table('HomeworkChecks').filter(function (c) { return itemIds[LMS.toStr(c.item_id)]; });
    var examsByKey = {};
    table('SchoolExams').forEach(function (e) {
      if (e.exam_date && LMS.inRange(e.exam_date, now, LMS.addDays(now, 60))) {
        var k = LMS.toStr(e.school_key);
        if (!examsByKey[k] || examsByKey[k].exam_date > e.exam_date) examsByKey[k] = e;
      }
    });
    var classDone = 0;
    var classTotal = 0;
    var classPresent = 0;
    var exams = {};
    var students = roster.map(function (s, i) {
      var alias = 'S' + (i + 1);
      aliases[alias] = s.student_id;
      var own = lessons.filter(function (l) { return LMS.toStr(l.student_id) === LMS.toStr(s.student_id); })
        .sort(function (a, b) { return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date)); });
      var present = own.filter(function (l) { return LMS.toStr(l.attendance) !== '결석'; }).length;
      var mine = checks.filter(function (c) { return LMS.toStr(c.student_id) === LMS.toStr(s.student_id); });
      var done = mine.filter(function (c) { return LMS.toStr(c.status) === '완료'; }).length;
      classDone += done;
      classTotal += mine.length;
      classPresent += present;
      var exam = examsByKey[LMS.schoolGroupKey(s.school, s.grade)];
      if (exam) exams[exam.school_exam_id] = exam;
      var counsel = table('CounselingNotes').filter(function (n) {
        return LMS.toStr(n.student_id) === LMS.toStr(s.student_id) && LMS.inRange(n.counsel_date, since, now);
      }).length;
      return {
        ref: alias,
        grade: LMS.toStr(s.grade),
        attendance_rate: rate(present, own.length),
        homework_rate: rate(done, mine.length),
        recent_tests: own.filter(function (l) { return LMS.toStr(l.test_status) === '실시'; }).slice(-4).map(function (l) {
          return { date: l.lesson_date, score: LMS.toNum(l.test_score), max: LMS.toNum(l.test_max_score) };
        }),
        signals: LMS.detectLearningSignals(own).map(function (sig) { return sig.label; }),
        counseling_last_4_weeks: counsel,
        next_school_exam: exam ? { date: exam.exam_date, scope: LMS.clipText(exam.scope, 200) } : null
      };
    });
    var sessions = table('ClassSessions').filter(function (r) {
      return LMS.toStr(r.class_id) === LMS.toStr(classId) && LMS.inRange(r.lesson_date, since, now);
    }).sort(function (a, b) { return LMS.toStr(a.lesson_date).localeCompare(LMS.toStr(b.lesson_date)); });
    var dailyByDate = {};
    classPlans(classId).forEach(function (p) { if (p.period_type === '일간') dailyByDate[LMS.toStr(p.period_key)] = p; });
    var range = computed.range;
    var cancelled = LMS.classCancelDates(cls).filter(function (c) { return LMS.inRange(c.date, range.start, range.end); }).length;
    return {
      base_version: baseVersion(cls),
      aliases: aliases,
      baseline: computed.proposal,
      input: {
        today: now,
        month: month,
        class: { name: cls.class_name, grade: LMS.toStr(cls.grade), textbook: LMS.toStr(cls.textbook), schedule: LMS.scheduleLabel(LMS.classSchedule(cls)) },
        curriculum: computed.curriculum.map(function (u) {
          return { unit_id: u.unit_id, textbook: u.textbook, title: u.title, sessions: u.sessions, done: Math.round((computed.done[u.unit_id] || 0) * 10) / 10 };
        }),
        plannable_dates: computed.editable.map(function (d) { return { date: d, weekday: LMS.weekdayName(d) }; }),
        cancelled_this_month: cancelled,
        recent_sessions: sessions.map(function (r) {
          var p = dailyByDate[LMS.toStr(r.lesson_date)];
          return {
            date: r.lesson_date,
            planned: p ? LMS.clipText(p.title, 80) : '',
            progress: LMS.clipText(r.progress, 120),
            done_status: p ? LMS.toStr(p.done_status) : ''
          };
        }).slice(-12),
        class_stats_last_4_weeks: {
          attendance_rate: rate(classPresent, lessons.length),
          homework_rate: rate(classDone, classTotal)
        },
        upcoming_school_exams: Object.keys(exams).map(function (id) {
          var e = exams[id];
          return { school: LMS.toStr(e.school), grade: LMS.toStr(e.grade), date: e.exam_date, scope: LMS.clipText(e.scope, 200) };
        }).sort(function (a, b) { return a.date.localeCompare(b.date); }),
        students: students,
        basic_split: computed.proposal.days.map(function (d) { return { date: d.date, unit_ids: d.unit_ids, title: d.title }; })
      }
    };
  }

  function cleanPlanText(src, fallback) {
    src = src && typeof src === 'object' ? src : {};
    fallback = fallback || {};
    var title = LMS.clipText(src.title, 200) || LMS.toStr(fallback.title);
    return {
      title: title,
      objectives: LMS.clipText(src.objectives, 2000) || LMS.toStr(fallback.objectives),
      content: LMS.clipText(src.content, 4000),
      homework: LMS.clipText(src.homework, 1000),
      materials: LMS.clipText(src.materials, 500),
      rationale: LMS.clipText(src.reason || src.rationale, 500)
    };
  }

  /**
   * Validate an AI reply against the real calendar, curriculum and roster, fill gaps from the
   * basic split, and store it as the pending draft. Students in `result` are already mapped to ids.
   */
  function saveAiPlanDraft(classId, month, result, meta) {
    return ctx.withLock(function () {
      var cls = ctx.requireClass(classId);
      month = assertMonth(month);
      meta = meta || {};
      result = result && typeof result === 'object' ? result : {};
      var computed = computeProposal(cls, month);
      if (!computed.editable.length) throw new Error('이 달에는 계획을 바꿀 수 있는 남은 수업일이 없습니다.');
      var warnings = [];
      var unitIds = {};
      computed.curriculum.forEach(function (u) { unitIds[u.unit_id] = true; });
      var baseDays = {};
      computed.proposal.days.forEach(function (d) { baseDays[d.date] = d; });
      var aiDays = {};
      var dropped = 0;
      (Array.isArray(result.days) ? result.days : []).forEach(function (d) {
        var date = LMS.toStr(d && d.date);
        if (!baseDays[date] || aiDays[date]) {
          dropped += 1;
          return;
        }
        var units = LMS.uniqueIds(LMS.jsonList(d.unit_ids)).filter(function (u) { return unitIds[u]; });
        var text = cleanPlanText(d, baseDays[date]);
        aiDays[date] = Object.assign({ period_type: '일간', period_key: date, date: date, unit_ids: units }, text);
      });
      if (dropped) warnings.push('수업일이 아니거나 중복된 날짜 ' + dropped + '건은 뺐습니다.');
      var filled = 0;
      var days = computed.editable.map(function (date) {
        if (aiDays[date]) return aiDays[date];
        filled += 1;
        return baseDays[date];
      });
      if (filled) warnings.push('AI가 빠뜨린 수업일 ' + filled + '일은 기본 분할로 채웠습니다.');
      var monthPlan = computed.proposal.month ? Object.assign({}, computed.proposal.month, cleanPlanText(result.month, computed.proposal.month)) : null;
      var roster = {};
      ctx.assignments.recordTargets(classId, today()).students.forEach(function (s) { roster[LMS.toStr(s.student_id)] = true; });
      var perStudent = {};
      var suggestions = [];
      var badStudents = 0;
      (Array.isArray(result.students) ? result.students : []).forEach(function (s) {
        var sid = LMS.toStr(s && s.student_id);
        var kind = LMS.toStr(s && s.kind);
        var title = LMS.clipText(s && s.title, 200);
        if (!roster[sid] || LMS.SUGGESTION_KIND.indexOf(kind) === -1 || !title) {
          badStudents += 1;
          return;
        }
        perStudent[sid] = (perStudent[sid] || 0) + 1;
        if (perStudent[sid] > 2 || suggestions.length >= 20) return;
        suggestions.push({ key: 'student|' + suggestions.length, student_id: sid, kind: kind, title: title, reason: LMS.clipText(s.reason, 500) });
      });
      if (badStudents) warnings.push('반 명단에 없거나 형식이 틀린 학생 제안 ' + badStudents + '건은 뺐습니다.');
      var payload = {
        month: monthPlan,
        days: days,
        carry_over: computed.proposal.carry_over,
        students: suggestions,
        rationale: LMS.clipText(result.rationale, 2000)
      };
      var current = baseVersion(cls);
      if (meta.base_version && meta.base_version !== current) {
        warnings.push('AI가 계획을 만드는 사이 반 계획이 바뀌었습니다. 아래 비교는 바뀐 계획 기준입니다.');
      }
      writeDraft(cls, month, 'ai', payload, warnings, LMS.toStr(meta.base_version) || current, meta.model);
      return getPlanBoard(classId, month);
    });
  }

  /**
   * The teacher's edit to one draft item before confirming: a month goal, a day plan or a student
   * suggestion. Past and recorded days stay locked. Edited items are marked so confirming them
   * stores the teacher's version as their own plan.
   */
  function updatePlanDraftItem(data) {
    return ctx.withLock(function () {
      data = data || {};
      var rows = table('PlanDrafts');
      var draft = LMS.findById(rows, 'draft_id', data.draft_id);
      if (!draft) throw new Error('계획 초안을 찾을 수 없습니다.');
      if (LMS.toStr(draft.status) !== '대기') throw new Error('이미 처리된 초안입니다. 화면을 새로 고쳐 주세요.');
      var cls = ctx.requireClass(draft.class_id);
      var month = LMS.toStr(draft.month);
      var payload = draftPayload(draft);
      if (!payload) throw new Error('초안 내용을 읽을 수 없습니다. 다시 만들어 주세요.');
      var key = LMS.toStr(data.key);
      var fields = data.fields && typeof data.fields === 'object' ? data.fields : {};
      if (key.indexOf('student|') === 0) {
        var st = (payload.students || []).filter(function (x) { return LMS.toStr(x.key) === key; })[0];
        if (!st) throw new Error('고칠 제안을 찾을 수 없습니다.');
        var title = LMS.clipText(fields.title, 200);
        if (!title) throw new Error('제안 내용을 입력해 주세요.');
        st.title = title;
        st.kind = LMS.assertEnum(fields.kind || st.kind, LMS.SUGGESTION_KIND, '제안 종류');
        st.reason = LMS.clipText(fields.reason, 500);
        st.edited = true;
      } else {
        var target = null;
        if (payload.month && key === '월간|' + payload.month.period_key) target = payload.month;
        (payload.days || []).forEach(function (d) { if (key === '일간|' + d.period_key) target = d; });
        if (!target) throw new Error('고칠 계획을 찾을 수 없습니다.');
        if (target.period_type === '일간' && computeProposal(cls, month).locked[target.period_key]) {
          throw new Error('지난 수업이나 기록이 있는 날의 계획은 초안에서 고칠 수 없습니다.');
        }
        var unitIds = {};
        LMS.classCurriculum(cls).forEach(function (u) { unitIds[u.unit_id] = true; });
        var text = cleanPlanText(fields, {});
        if (!text.title && !text.objectives && !text.content) throw new Error('계획 내용을 한 곳 이상 입력해 주세요.');
        ['title', 'objectives', 'content', 'homework', 'materials'].forEach(function (k) { target[k] = text[k]; });
        if (fields.unit_ids !== undefined) {
          target.unit_ids = LMS.uniqueIds(LMS.jsonList(fields.unit_ids)).filter(function (u) { return unitIds[u]; });
        }
        target.edited = true;
      }
      draft.payload = payload;
      draft.updated_at = ctx.now();
      saveTable('PlanDrafts', rows);
      return getPlanBoard(cls.class_id, month);
    });
  }

  // ----- Single-day cancellations -----

  function dailyPlanOn(classId, date) {
    return classPlans(classId).filter(function (p) {
      return LMS.toStr(p.period_type) === '일간' && LMS.toStr(p.period_key) === date;
    })[0] || null;
  }

  function cancelClassDate(data) {
    return ctx.withLock(function () {
      data = data || {};
      var date = LMS.toStr(data.date);
      if (!LMS.isIsoDate(date)) throw new Error('휴강할 날짜를 선택해 주세요.');
      var rows = table('Classes');
      var cls = LMS.findById(rows, 'class_id', data.class_id);
      if (!cls) throw new Error('반 정보를 찾을 수 없습니다.');
      if (LMS.classCancellationOn(cls, date)) throw new Error('이미 휴강으로 지정된 날입니다.');
      if (!LMS.classMeetsOnDate(cls, date, ctx.examPeriods())) throw new Error('이 날은 이 반의 수업일이 아닙니다.');
      if (recordedDates(cls.class_id)[date]) {
        throw new Error('이미 수업 기록이 있는 날은 휴강할 수 없습니다. 기록을 먼저 지워 주세요.');
      }
      var ts = ctx.now();
      var list = LMS.classCancelDates(cls).concat([{ date: date, reason: LMS.clipText(data.reason, 200), created_at: ts }]);
      list.sort(function (a, b) { return LMS.toStr(a.date).localeCompare(LMS.toStr(b.date)); });
      cls.cancel_dates = list;
      cls.updated_at = ts;
      saveTable('Classes', rows);
      return { class_id: cls.class_id, date: date, plan: slimPlan(dailyPlanOn(cls.class_id, date)) };
    });
  }

  function restoreClassDate(data) {
    return ctx.withLock(function () {
      data = data || {};
      var date = LMS.toStr(data.date);
      var rows = table('Classes');
      var cls = LMS.findById(rows, 'class_id', data.class_id);
      if (!cls) throw new Error('반 정보를 찾을 수 없습니다.');
      if (!LMS.classCancellationOn(cls, date)) throw new Error('휴강으로 지정된 날이 아닙니다.');
      cls.cancel_dates = LMS.classCancelDates(cls).filter(function (c) { return LMS.toStr(c.date) !== date; });
      cls.updated_at = ctx.now();
      saveTable('Classes', rows);
      return { class_id: cls.class_id, date: date, plan: slimPlan(dailyPlanOn(cls.class_id, date)) };
    });
  }

  /** The unit the class is on now (first unfinished in curriculum order), or null without a list. */
  function getCurrentUnit(classId) {
    var cls = ctx.requireClass(classId);
    if (!LMS.classCurriculum(cls).length) return null;
    var computed = computeProposal(cls, today().slice(0, 7));
    var slot = computed.queue[0];
    if (!slot) return { title: '', all_done: true };
    return { unit_id: slot.unit.unit_id, title: slot.unit.title, index: slot.index, sessions: slot.total, all_done: false };
  }

  /** Done status of the day's plan, set from the lesson recorder. Blank clears it. */
  function setDailyPlanDone(classId, date, status) {
    var value = LMS.assertEnum(status, LMS.PLAN_DONE_STATUS, '진행 결과', true);
    var plans = table('ClassPlans');
    var plan = dailyPlanOn(classId, date);
    if (!plan) return null;
    var row = LMS.findById(plans, 'plan_id', plan.plan_id);
    row.done_status = value;
    row.updated_at = ctx.now();
    saveTable('ClassPlans', plans);
    return slimPlan(row);
  }

  return {
    getPlanBoard: getPlanBoard,
    createSplitDraft: createSplitDraft,
    discardPlanDraft: discardPlanDraft,
    applyPlanDraft: applyPlanDraft,
    getClassPlanContext: getClassPlanContext,
    saveAiPlanDraft: saveAiPlanDraft,
    updatePlanDraftItem: updatePlanDraftItem,
    getCurrentUnit: getCurrentUnit,
    cancelClassDate: cancelClassDate,
    restoreClassDate: restoreClassDate,
    setDailyPlanDone: setDailyPlanDone
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
