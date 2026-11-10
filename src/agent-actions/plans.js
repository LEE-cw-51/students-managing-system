/**
 * AI write actions: class plans (진도). Definition shape: src/08_AgentActions.js.
 * cancelClassDate (06_Plans.js) belongs to the class actions.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../00_Core.js');
}

(function () {
  var CLASS_ID = LMS.AGENT_PARAM.classId;
  var PLAN_ID = { type: 'string', description: '강의 계획 ID (예: PLN-0005). get_class_plans 또는 get_plan_board에서 찾습니다.' };
  var PLAN_TEXT_PARAMS = {
    title: { type: 'string', description: '제목' },
    objectives: { type: 'string', description: '학습 목표' },
    content: { type: 'string', description: '수업 내용' },
    materials: { type: 'string', description: '교재·자료' },
    homework: { type: 'string', description: '숙제' },
    memo: { type: 'string', description: '메모' }
  };
  var PLAN_TEXT_FIELDS = Object.keys(PLAN_TEXT_PARAMS);
  var PLAN_LABELS = { title: '제목', objectives: '목표', content: '내용', materials: '자료', homework: '숙제', memo: '메모' };

  function requireClass(svc, classId) {
    if (!LMS.findById(svc.table('Classes'), 'class_id', classId)) throw new Error('반 정보(' + (LMS.toStr(classId) || '없음') + ')를 찾을 수 없습니다.');
  }

  function findPlan(svc, classId, periodType, periodKey) {
    return svc.table('ClassPlans').filter(function (p) {
      return LMS.toStr(p.class_id) === classId && LMS.toStr(p.period_type) === periodType && LMS.toStr(p.period_key) === periodKey;
    })[0] || null;
  }

  /** "중2 A반 주간 계획(2026-09-14 주)" */
  function planName(svc, p) {
    var key = LMS.toStr(p.period_key);
    var when = p.period_type === '주간' ? key + ' 주' : key;
    return LMS.agentClassName(svc.table, p.class_id) + ' ' + LMS.toStr(p.period_type) + ' 계획(' + when + ')';
  }

  function planSummary(p) {
    return LMS.toStr(p.title) || LMS.toStr(p.content).slice(0, 40) || LMS.toStr(p.objectives).slice(0, 40);
  }

  var actions = {
    save_class_plan: {
      label: '강의 계획 저장',
      progress: '강의 계획 저장 준비 중',
      description: '반의 일간·주간·월간 강의 계획을 작성하거나 고칩니다. 같은 반·기간 계획이 이미 있으면 그 계획을 고치며, 넣지 않은 항목은 그대로 둡니다. 자동 분배된 계획을 고치면 직접 작성한 계획으로 바뀝니다.',
      parameters: {
        type: 'object',
        properties: Object.assign({
          plan_id: Object.assign({}, PLAN_ID, { description: '고칠 계획 ID (선택). 없으면 class_id·period_type·period_key로 찾거나 새로 만듭니다.' }),
          class_id: CLASS_ID,
          period_type: { type: 'string', enum: LMS.PLAN_PERIOD, description: '일간, 주간, 월간' },
          period_key: { type: 'string', description: '일간: 날짜(YYYY-MM-DD), 주간: 그 주의 아무 날짜(YYYY-MM-DD), 월간: YYYY-MM' }
        }, PLAN_TEXT_PARAMS, {
          done_status: { type: 'string', enum: LMS.PLAN_DONE_STATUS.concat(['']), description: '일간 계획의 진행 결과 (선택)' }
        }),
        required: ['class_id', 'period_type', 'period_key']
      },
      preview: function (svc, args) {
        args = args || {};
        var planId = LMS.toStr(args.plan_id);
        var existing = null;
        if (planId) {
          existing = LMS.findById(svc.table('ClassPlans'), 'plan_id', planId);
          if (!existing) throw new Error('강의 계획(' + planId + ')을 찾을 수 없습니다.');
        }
        var base = {
          class_id: LMS.toStr(args.class_id) || (existing ? LMS.toStr(existing.class_id) : ''),
          period_type: LMS.toStr(args.period_type) || (existing ? LMS.toStr(existing.period_type) : ''),
          period_key: LMS.toStr(args.period_key) || (existing ? LMS.toStr(existing.period_key) : '')
        };
        // Validate the period first to find the plan the service would overwrite.
        var periodType = LMS.assertEnum(base.period_type, LMS.PLAN_PERIOD, '계획 기간');
        if (LMS.isBlank(base.class_id)) throw new Error('반을 선택해 주세요.');
        var periodKey = LMS.normalizePlanPeriodKey(periodType, base.period_key);
        requireClass(svc, base.class_id);
        var same = findPlan(svc, base.class_id, periodType, periodKey);
        if (existing && same && LMS.toStr(same.plan_id) !== LMS.toStr(existing.plan_id)) throw new Error('같은 반·기간의 계획이 이미 있습니다.');
        existing = existing || same;
        var data = { class_id: base.class_id, period_type: periodType, period_key: periodKey };
        PLAN_TEXT_FIELDS.forEach(function (k) {
          data[k] = args[k] !== undefined && args[k] !== null ? args[k] : (existing ? existing[k] : '');
        });
        data.unit_ids = existing ? LMS.jsonList(existing.unit_ids) : [];
        if (args.done_status !== undefined && args.done_status !== null) data.done_status = args.done_status;
        if (existing) data.plan_id = LMS.toStr(existing.plan_id);
        var input = LMS.validateClassPlanInput(data, Boolean(existing));
        var out = {
          class_id: input.class_id, period_type: input.period_type, period_key: input.period_key,
          title: input.title, objectives: input.objectives, content: input.content,
          materials: input.materials, homework: input.homework, memo: input.memo, unit_ids: input.unit_ids
        };
        if (existing) out.plan_id = input.plan_id;
        if (Object.prototype.hasOwnProperty.call(data, 'done_status')) out.done_status = input.done_status;
        var name = planName(svc, out);
        var changed = existing ? PLAN_TEXT_FIELDS.filter(function (k) { return LMS.toStr(existing[k]) !== LMS.toStr(out[k]); }) : [];
        var doneChange = Object.prototype.hasOwnProperty.call(out, 'done_status') && out.done_status !== LMS.toStr(existing && existing.done_status)
          ? '진행 결과 ' + (LMS.toStr(existing && existing.done_status) || '없음') + ' → ' + (out.done_status || '없음') : '';
        var what = changed.map(function (k) { return PLAN_LABELS[k]; }).join('·');
        var moved = existing && (LMS.toStr(existing.class_id) !== out.class_id || LMS.toStr(existing.period_type) !== out.period_type || LMS.toStr(existing.period_key) !== out.period_key)
          ? '기간 ' + planName(svc, existing) + ' → ' + name : '';
        if (existing && !changed.length && !doneChange && !moved) throw new Error('바뀌는 내용이 없습니다. 바꿀 항목과 새 값을 입력해 주세요.');
        var text = existing
          ? name + ' 「' + planSummary(existing) + '」 수정: ' + [moved, what ? what + ' 바꿈' : '', doneChange].filter(Boolean).join(', ') +
            (LMS.toStr(existing.source) && LMS.toStr(existing.source) !== 'manual' ? ' (자동 분배 계획을 직접 작성으로 바꿈)' : '')
          : name + ' 새로 작성: 「' + planSummary(out) + '」';
        return {
          args: out,
          target: { class_name: LMS.agentClassName(svc.table, out.class_id), date: out.period_key },
          before: existing ? planSummary(existing) : '',
          after: planSummary(out),
          text: text
        };
      },
      run: function (svc, args) {
        return svc.api.saveClassPlan(args);
      },
      verify: function (svc, args, ran) {
        var id = (ran && ran.plan_id) || args.plan_id;
        var row = id ? LMS.findById(svc.table('ClassPlans'), 'plan_id', id) : null;
        var ok = Boolean(row) && LMS.toStr(row.class_id) === args.class_id && LMS.toStr(row.period_type) === args.period_type &&
          LMS.toStr(row.period_key) === args.period_key &&
          PLAN_TEXT_FIELDS.every(function (k) { return LMS.toStr(row[k]) === LMS.toStr(args[k]); }) &&
          LMS.uniqueIds(LMS.jsonList(row.unit_ids)).join(',') === LMS.uniqueIds(LMS.jsonList(args.unit_ids)).join(',') &&
          (args.done_status === undefined || LMS.toStr(row.done_status) === LMS.toStr(args.done_status));
        return { ok: ok, after: row ? LMS.toStr(row.plan_id) : '' };
      }
    },

    delete_class_plan: {
      label: '강의 계획 삭제',
      progress: '강의 계획 삭제 준비 중',
      description: '강의 계획 하나를 지웁니다. 지우기 전에 어떤 반·기간의 계획인지 사용자에게 확인합니다.',
      parameters: { type: 'object', properties: { plan_id: PLAN_ID }, required: ['plan_id'] },
      preview: function (svc, args) {
        var planId = LMS.toStr(args && args.plan_id);
        var plan = LMS.findById(svc.table('ClassPlans'), 'plan_id', planId);
        if (!plan) throw new Error('강의 계획(' + (planId || '없음') + ')을 찾을 수 없습니다.');
        return {
          args: { plan_id: planId },
          target: { class_name: LMS.agentClassName(svc.table, plan.class_id), date: LMS.toStr(plan.period_key) },
          before: planSummary(plan),
          after: '',
          text: planName(svc, plan) + ' 「' + planSummary(plan) + '」 삭제' + (plan.done_status ? ' (진행 결과 ' + LMS.toStr(plan.done_status) + ' 기록도 사라짐)' : '')
        };
      },
      run: function (svc, args) {
        return svc.api.deleteClassPlan(args.plan_id);
      },
      verify: function (svc, args) {
        var gone = !LMS.findById(svc.table('ClassPlans'), 'plan_id', args.plan_id);
        return { ok: gone, after: gone ? '삭제됨' : '남아 있음' };
      }
    },

    set_daily_plan_done: {
      label: '진도 결과',
      progress: '진도 결과 기록 준비 중',
      description: '그날 일간 계획의 진행 결과(완료/일부/못 함)를 기록합니다. 빈 문자열이면 결과를 지웁니다. 그날 일간 계획이 있어야 합니다.',
      parameters: {
        type: 'object',
        properties: {
          class_id: CLASS_ID,
          date: LMS.AGENT_PARAM.date('수업일'),
          status: { type: 'string', enum: LMS.PLAN_DONE_STATUS.concat(['']), description: '완료, 일부, 못 함 (빈 문자열이면 지움)' }
        },
        required: ['class_id', 'date', 'status']
      },
      preview: function (svc, args) {
        args = args || {};
        var classId = LMS.toStr(args.class_id);
        var date = LMS.toStr(args.date);
        requireClass(svc, classId);
        if (!LMS.isIsoDate(date)) throw new Error('날짜 형식이 올바르지 않습니다. YYYY-MM-DD로 입력해 주세요.');
        var status = LMS.assertEnum(args.status, LMS.PLAN_DONE_STATUS, '진행 결과', true);
        var plan = findPlan(svc, classId, '일간', date);
        if (!plan) throw new Error(LMS.agentClassName(svc.table, classId) + '의 ' + date + ' 일간 계획이 없습니다. 진행 결과는 일간 계획이 있는 날만 기록할 수 있습니다.');
        var before = LMS.toStr(plan.done_status);
        return {
          args: { class_id: classId, date: date, status: status },
          target: { class_name: LMS.agentClassName(svc.table, classId), date: date },
          before: before,
          after: status,
          text: LMS.agentClassName(svc.table, classId) + ' · ' + date + ' 진도 「' + planSummary(plan) + '」 결과: ' + (before || '없음') + ' → ' + (status || '없음')
        };
      },
      run: function (svc, args) {
        return svc.api.setDailyPlanDone(args.class_id, args.date, args.status);
      },
      verify: function (svc, args) {
        var plan = findPlan(svc, args.class_id, '일간', args.date);
        var after = plan ? LMS.toStr(plan.done_status) : '';
        return { ok: Boolean(plan) && after === args.status, after: after };
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = actions;
  }
})();
