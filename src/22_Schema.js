/**
 * Schema versioning and migrations for lms.kv JSON stores.
 * Idempotent steps versioned in _Meta under LMS.SCHEMA_META_KEY.
 * Server-only: reads and writes tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable.
 * Callers run commands inside the service transaction.
 */
LMS.createSchema = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

  function schemaVersion_() {
    var row = LMS.findById(table('_Meta'), 'prefix', LMS.SCHEMA_META_KEY);
    var v = row ? parseInt(row.next_seq, 10) : 1;
    return isFinite(v) ? v : 1;
  }

  /** v7: homework checks store A–F. 완료 → A, 미완료 → F. Safe to re-run. */
  function migrateToV7_() {
    var checks = table('HomeworkChecks');
    var checksChanged = false;
    checks.forEach(function (c) {
      var raw = LMS.toStr(c.status);
      if (raw === '완료') { c.status = 'A'; checksChanged = true; }
      else if (raw === '미완료') { c.status = 'F'; checksChanged = true; }
    });
    if (checksChanged) saveTable('HomeworkChecks', checks);

    var rows = table('Settings');
    var settingsChanged = false;
    function put(key, value) {
      var row = LMS.findById(rows, 'key', key);
      if (!row) {
        rows.push({ key: key, value: value });
        settingsChanged = true;
        return;
      }
      if (LMS.toStr(row.value) === '') {
        row.value = value;
        settingsChanged = true;
      }
    }
    rows.forEach(function (row) {
      if (row.key === 'assignment_B' && row.value === '89~70%') { row.value = '89~80%'; settingsChanged = true; }
      if (row.key === 'assignment_C' && row.value === '70% 미만') { row.value = '79~70%'; settingsChanged = true; }
    });
    put('assignment_D', LMS.DEFAULT_SETTINGS.assignment_D);
    put('assignment_E', LMS.DEFAULT_SETTINGS.assignment_E);
    put('assignment_F', LMS.DEFAULT_SETTINGS.assignment_F);
    if (settingsChanged) saveTable('Settings', rows);
  }

  /** Bring stored tables up to LMS.SCHEMA_VERSION. Returns true when anything ran. */
  function ensureSchema() {
    var version = schemaVersion_();
    if (version >= LMS.SCHEMA_VERSION) return false;
    // Steps up to v6 were removed once every live database had passed them. Data older than v6 must
    // first be opened with a release that still has them; an empty database starts at the current version.
    if (version < 6 && (table('Students').length || table('Classes').length)) {
      throw new Error('저장된 데이터가 너무 오래된 구조(v' + version + ')입니다. v6까지 올려 주는 이전 버전으로 한 번 접속한 뒤 다시 열어 주세요.');
    }
    migrateToV7_();
    var meta = table('_Meta');
    var row = LMS.findById(meta, 'prefix', LMS.SCHEMA_META_KEY);
    if (!row) {
      row = { prefix: LMS.SCHEMA_META_KEY, next_seq: LMS.SCHEMA_VERSION };
      meta.push(row);
    }
    row.next_seq = LMS.SCHEMA_VERSION;
    saveTable('_Meta', meta);
    return true;
  }

  return {
    ensureSchema: ensureSchema
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
