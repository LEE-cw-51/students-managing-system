/**
 * AI write actions: monthly reports (리포트). Same shape as LMS.AGENT_WRITE_ACTIONS in
 * 07_Agent.js ({ label, preview, run, verify }); each name needs a tool in lib/mcp-tools/write-reports.js.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('../07_Agent.js');
}

LMS.registerAgentWriteActions({
  save_monthly_report: {
    label: '월간 리포트 저장',
    preview: function (svc, args) {
      args = args || {};
      var studentId = LMS.toStr(args.student_id);
      if (!LMS.findById(svc.table('Students'), 'student_id', studentId)) throw new Error('학생 정보(' + (studentId || '없음') + ')를 찾을 수 없습니다.');
      var year = Number(args.year);
      var month = Number(args.month);
      if (!year || !month || month < 1 || month > 12 || Math.floor(month) !== month) throw new Error('연도와 월을 올바르게 입력해 주세요.');
      var status = LMS.assertEnum(LMS.toStr(args.status) || '임시', LMS.REPORT_STATUS, '보고서 상태');
      var text = LMS.toStr(args.report_text);
      if (!text) throw new Error('보고서 내용을 입력해 주세요.');
      var existing = svc.table('MonthlyReports').filter(function (r) {
        return LMS.toStr(r.student_id) === studentId && Number(r.year) === year && Number(r.month) === month;
      })[0] || null;
      var name = LMS.agentStudentName(svc.table, studentId);
      var head = name + ' · ' + year + '년 ' + month + '월 월간 리포트 ';
      var detail = existing
        ? '덮어쓰기 (' + LMS.toStr(existing.status) + ' → ' + status + ', 기존 ' + LMS.toStr(existing.report_text).length + '자 → ' + text.length + '자)'
        : '새로 저장 (' + status + ', ' + text.length + '자)';
      return {
        args: { student_id: studentId, year: year, month: month, report_text: text, status: status },
        target: { student_id: studentId, student_name: name, date: year + '-' + (month < 10 ? '0' : '') + month },
        before: existing ? LMS.toStr(existing.report_text) : '',
        after: text,
        text: head + detail
      };
    },
    run: function (svc, args) {
      return svc.api.saveMonthlyReport(args);
    },
    verify: function (svc, args) {
      var row = svc.table('MonthlyReports').filter(function (r) {
        return LMS.toStr(r.student_id) === args.student_id && Number(r.year) === args.year && Number(r.month) === args.month;
      })[0];
      var ok = Boolean(row) && LMS.toStr(row.report_text) === args.report_text && LMS.toStr(row.status) === args.status;
      return { ok: ok, after: row ? LMS.toStr(row.status) : '' };
    }
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
