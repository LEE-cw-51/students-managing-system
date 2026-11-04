/**
 * AI write actions: class plans (진도). Same shape as LMS.AGENT_WRITE_ACTIONS in 07_Agent.js
 * ({ label, preview, run, verify }); each name needs a tool in lib/mcp-tools/write-plans.js.
 * cancelClassDate (06_Plans.js) belongs to the class actions.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../07_Agent.js');
}

(function () {
  var PLAN_TEXT_FIELDS = ['title', 'objectives', 'content', 'materials', 'homework', 'memo'];
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

  LMS.registerAgentWriteActions({
    save_class_plan: {
      label: '강의 계획 저장',
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
  });
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
