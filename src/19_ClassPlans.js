/**
 * Confirmed class plans (ClassPlans): get/list/save/delete for 일간·주간·월간 rows.
 * Distinct from the planner (`06_Plans.js`), which owns drafts, splits, and apply/cancel.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable, now, nextIds, requireClass.
 * Callers run commands inside the service transaction.
 */
LMS.createClassPlans = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

  function enrichClassPlan(row) {
    if (!row) return null;
    var cls = LMS.findById(table('Classes'), 'class_id', row.class_id);
    var range = LMS.planPeriodRange(row.period_type, row.period_key);
    return Object.assign({}, row, {
      class_name: cls ? cls.class_name : '',
      period_label: LMS.formatPlanPeriodLabel(row.period_type, row.period_key),
      period_start: range.start,
      period_end: range.end
    });
  }

  function findClassPlanRow_(classId, periodType, periodKey) {
    var key = LMS.normalizePlanPeriodKey(periodType, periodKey);
    var rows = table('ClassPlans');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (LMS.toStr(row.class_id) === LMS.toStr(classId) &&
          LMS.toStr(row.period_type) === LMS.toStr(periodType) &&
          LMS.toStr(row.period_key) === key) {
        return row;
      }
    }
    return null;
  }

  function getClassPlan(classId, periodType, periodKey) {
    ctx.requireClass(classId);
    LMS.assertEnum(periodType, LMS.PLAN_PERIOD, '계획 기간');
    return enrichClassPlan(findClassPlanRow_(classId, periodType, periodKey));
  }

  function getClassPlans(filter) {
    filter = filter || {};
    var classId = LMS.toStr(filter.class_id || filter.classId);
    var periodType = LMS.toStr(filter.period_type || filter.periodType);
    if (periodType) LMS.assertEnum(periodType, LMS.PLAN_PERIOD, '계획 기간');
    var start = LMS.toStr(filter.start);
    var end = LMS.toStr(filter.end);
    if (start && !LMS.isIsoDate(start)) throw new Error('시작일 형식이 올바르지 않습니다.');
    if (end && !LMS.isIsoDate(end)) throw new Error('종료일 형식이 올바르지 않습니다.');
    return table('ClassPlans').filter(function (row) {
      if (classId && LMS.toStr(row.class_id) !== classId) return false;
      if (periodType && LMS.toStr(row.period_type) !== periodType) return false;
      if (start || end) {
        var range = LMS.planPeriodRange(row.period_type, row.period_key);
        if (end && range.start > end) return false;
        if (start && range.end < start) return false;
      }
      return true;
    }).map(enrichClassPlan).sort(function (a, b) {
      var dk = LMS.toStr(b.period_key).localeCompare(LMS.toStr(a.period_key));
      if (dk) return dk;
      return LMS.toStr(a.period_type).localeCompare(LMS.toStr(b.period_type), 'ko');
    });
  }

  function saveClassPlan(data) {
    var isUpdate = !LMS.isBlank(data && data.plan_id);
    var input = LMS.validateClassPlanInput(data, isUpdate);
    ctx.requireClass(input.class_id);
    var rows = table('ClassPlans');
    var ts = ctx.now();
    var existing = null;
    var idx = -1;
    if (isUpdate) {
      for (var i = 0; i < rows.length; i++) {
        if (LMS.toStr(rows[i].plan_id) === input.plan_id) {
          existing = rows[i];
          idx = i;
          break;
        }
      }
      if (!existing) throw new Error('강의 계획을 찾을 수 없습니다.');
    } else {
      existing = findClassPlanRow_(input.class_id, input.period_type, input.period_key);
      if (existing) {
        idx = rows.indexOf(existing);
      }
    }
    if (existing && idx >= 0) {
      var conflict = findClassPlanRow_(input.class_id, input.period_type, input.period_key);
      if (conflict && LMS.toStr(conflict.plan_id) !== LMS.toStr(existing.plan_id)) {
        throw new Error('같은 반·기간의 계획이 이미 있습니다.');
      }
      var updated = Object.assign({}, existing, {
        class_id: input.class_id,
        period_type: input.period_type,
        period_key: input.period_key,
        title: input.title,
        objectives: input.objectives,
        content: input.content,
        materials: input.materials,
        homework: input.homework,
        memo: input.memo,
        unit_ids: input.unit_ids,
        // A hand edit makes the plan the teacher's own; later splits treat it as fixed.
        source: 'manual',
        done_status: Object.prototype.hasOwnProperty.call(data, 'done_status') ? input.done_status : LMS.toStr(existing.done_status),
        updated_at: ts
      });
      rows[idx] = updated;
      saveTable('ClassPlans', rows);
      return enrichClassPlan(updated);
    }
    var created = {
      plan_id: ctx.nextIds('PLN', 1)[0],
      class_id: input.class_id,
      period_type: input.period_type,
      period_key: input.period_key,
      title: input.title,
      objectives: input.objectives,
      content: input.content,
      materials: input.materials,
      homework: input.homework,
      memo: input.memo,
      unit_ids: input.unit_ids,
      source: 'manual',
      rationale: '',
      done_status: input.done_status,
      created_at: ts,
      updated_at: ts
    };
    rows.push(created);
    saveTable('ClassPlans', rows);
    return enrichClassPlan(created);
  }

  function deleteClassPlan(planId) {
    var id = LMS.toStr(planId);
    if (!id) throw new Error('강의 계획을 찾을 수 없습니다.');
    var rows = table('ClassPlans');
    var next = rows.filter(function (row) {
      return LMS.toStr(row.plan_id) !== id;
    });
    if (next.length === rows.length) throw new Error('강의 계획을 찾을 수 없습니다.');
    saveTable('ClassPlans', next);
    return { deleted: true, plan_id: id };
  }

  return {
    getClassPlan: getClassPlan,
    getClassPlans: getClassPlans,
    saveClassPlan: saveClassPlan,
    deleteClassPlan: deleteClassPlan
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
