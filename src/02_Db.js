/**
 * Google Sheets store: request memo, CacheService, incremental writes.
 */
var LMS = LMS || {};

var SHEET_STORE_ = null;
var SERVICE_ = null;
var SCHEMA_VERSION_ = 'lms-schema-v1';
var ALLOW_CACHE_KEY_ = 'lms_allow_emails';
var CACHE_TTL_ = 180;
var CACHEABLE_TABLES_ = {
  Settings: true,
  Classes: true,
  Students: true,
  StudentClasses: true,
  _Meta: true
};

function createSheetStore_() {
  var ssHandle = null;
  var tableCache = {};
  var snapshots = {};

  function cache() {
    try { return CacheService.getScriptCache(); } catch (e) { return null; }
  }

  function cacheKey(name) {
    return 'lms_table_' + name;
  }

  function putCache(name, rows) {
    if (!CACHEABLE_TABLES_[name]) return;
    var c = cache();
    if (!c) return;
    try { c.put(cacheKey(name), JSON.stringify(rows || []), CACHE_TTL_); } catch (e) {}
  }

  function invalidate(name) {
    var c = cache();
    if (!c) return;
    if (name) {
      c.remove(cacheKey(name));
      if (name === 'Settings') c.remove(ALLOW_CACHE_KEY_);
      return;
    }
    Object.keys(CACHEABLE_TABLES_).forEach(function (n) { c.remove(cacheKey(n)); });
    c.remove(ALLOW_CACHE_KEY_);
  }

  function formatNow() {
    return Utilities.formatDate(new Date(), LMS.TZ || 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss");
  }

  function formatToday() {
    return Utilities.formatDate(new Date(), LMS.TZ || 'Asia/Seoul', 'yyyy-MM-dd');
  }

  function cellToValue(v) {
    if (v instanceof Date) {
      return Utilities.formatDate(v, LMS.TZ || 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss");
    }
    return v;
  }

  function getSpreadsheet() {
    if (ssHandle) return ssHandle;
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SPREADSHEET_ID');
    var ss;
    if (id) {
      ss = SpreadsheetApp.openById(id);
    } else {
      ss = SpreadsheetApp.create('수학의힘_LMS_DB');
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
    if (props.getProperty('SCHEMA_VERSION') !== SCHEMA_VERSION_) {
      ensureSchema_(ss);
      props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION_);
    }
    ssHandle = ss;
    return ss;
  }

  function sheetByName(ss, name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    return sh;
  }

  function ensureSchema_(ss) {
    Object.keys(LMS.TABLES).forEach(function (name) {
      var headers = LMS.TABLES[name];
      var sh = sheetByName(ss, name);
      var first = sh.getRange(1, 1, 1, headers.length).getValues()[0];
      var empty = first.every(function (v) { return v === '' || v === null; });
      if (empty) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, headers.length).setNumberFormat('@');
      }
    });
    seedDefaults_(ss);
    var sheets = ss.getSheets();
    if (sheets.length) {
      var first = sheets[0];
      if (first.getName() === '시트1' || first.getName() === 'Sheet1') {
        if (first.getLastRow() === 0) ss.deleteSheet(first);
      }
    }
  }

  function seedDefaults_(ss) {
    var settingsSheet = sheetByName(ss, 'Settings');
    if (settingsSheet.getLastRow() < 2) {
      var rows = LMS.settingsToRows(LMS.DEFAULT_SETTINGS);
      writeRows_(settingsSheet, LMS.TABLES.Settings, rows);
    }
    var metaSheet = sheetByName(ss, '_Meta');
    if (metaSheet.getLastRow() < 2) {
      var meta = LMS.META_PREFIXES.map(function (p) {
        return { prefix: p, next_seq: 1 };
      });
      writeRows_(metaSheet, LMS.TABLES._Meta, meta);
    }
  }

  function readRows_(sh, headers) {
    var lastRow = sh.getLastRow();
    var lastCol = Math.max(sh.getLastColumn(), (headers || []).length || 1);
    if (lastRow < 2) return [];
    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
    var head = values[0].map(function (h) { return String(h); });
    var cols = headers || head;
    var out = [];
    for (var r = 1; r < values.length; r++) {
      var obj = {};
      var empty = true;
      for (var c = 0; c < cols.length; c++) {
        var key = cols[c];
        var idx = head.indexOf(key);
        var v = idx >= 0 ? cellToValue(values[r][idx]) : '';
        if (v !== '' && v !== null && v !== undefined) empty = false;
        obj[key] = v === null || v === undefined ? '' : v;
      }
      if (!empty) out.push(obj);
    }
    return out;
  }

  function writeRows_(sh, headers, rows) {
    var last = sh.getLastRow();
    if (last > 1) {
      sh.getRange(2, 1, last - 1, headers.length).clearContent();
    }
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setNumberFormat('@');
    if (!rows.length) return;
    var values = rows.map(function (row) { return LMS.rowValues(row, headers); });
    var range = sh.getRange(2, 1, values.length, headers.length);
    range.setNumberFormat('@');
    range.setValues(values);
  }

  function applyDiff_(sh, headers, diff, prevCount) {
    diff.updates.forEach(function (u) {
      var range = sh.getRange(u.row, 1, 1, headers.length);
      range.setNumberFormat('@');
      range.setValues([u.values]);
    });
    if (diff.appends.length) {
      var start = (prevCount || 0) + 2;
      var range = sh.getRange(start, 1, diff.appends.length, headers.length);
      range.setNumberFormat('@');
      range.setValues(diff.appends);
    }
  }

  function cloneRows_(rows) {
    return JSON.parse(JSON.stringify(rows || []));
  }

  function readTable(name) {
    if (Object.prototype.hasOwnProperty.call(tableCache, name)) {
      return tableCache[name];
    }
    if (CACHEABLE_TABLES_[name]) {
      var c = cache();
      if (c) {
        var hit = c.get(cacheKey(name));
        if (hit) {
          try {
            var parsed = JSON.parse(hit);
            tableCache[name] = parsed;
            snapshots[name] = cloneRows_(parsed);
            return parsed;
          } catch (e) {}
        }
      }
    }
    var ss = getSpreadsheet();
    var sh = sheetByName(ss, name);
    var rows = readRows_(sh, LMS.TABLES[name]);
    tableCache[name] = rows;
    snapshots[name] = cloneRows_(rows);
    putCache(name, rows);
    return rows;
  }

  function writeTable(name, rows) {
    rows = rows || [];
    var headers = LMS.TABLES[name];
    var prev = snapshots[name];
    var pk = LMS.TABLE_PK[name];
    var diff = prev ? LMS.diffTableRows(prev, rows, pk, headers) : { needsFullRewrite: true };
    var changed = diff.needsFullRewrite ||
      (diff.updates && diff.updates.length) ||
      (diff.appends && diff.appends.length);
    if (changed) {
      var sh = sheetByName(getSpreadsheet(), name);
      if (diff.needsFullRewrite) writeRows_(sh, headers, rows);
      else applyDiff_(sh, headers, diff, prev ? prev.length : 0);
    }
    tableCache[name] = rows;
    snapshots[name] = cloneRows_(rows);
    putCache(name, rows);
    if (changed && name === 'Settings') {
      var c = cache();
      if (c) {
        try { c.remove(ALLOW_CACHE_KEY_); } catch (e) {}
      }
    }
  }

  return {
    readTable: readTable,
    writeTable: writeTable,
    now: formatNow,
    today: formatToday,
    currentUserEmail: function () {
      try {
        return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
      } catch (e) {
        return '';
      }
    },
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        var result = fn();
        SpreadsheetApp.flush();
        return result;
      } finally {
        lock.releaseLock();
      }
    },
    invalidateCache: invalidate
  };
}

function getSheetStore_() {
  if (!SHEET_STORE_) SHEET_STORE_ = createSheetStore_();
  return SHEET_STORE_;
}

function getService_() {
  if (!SERVICE_) SERVICE_ = LMS.createService(getSheetStore_());
  return SERVICE_;
}

function cachedAllowedEmails_() {
  var c = null;
  try { c = CacheService.getScriptCache(); } catch (e) {}
  if (c) {
    var hit = c.get(ALLOW_CACHE_KEY_);
    if (hit !== null && hit !== undefined) {
      return hit === '*' ? '' : hit;
    }
  }
  var allowed = '';
  try { allowed = LMS.toStr(getService_().getSettings().allowed_emails); } catch (e2) {}
  if (c) {
    try { c.put(ALLOW_CACHE_KEY_, allowed ? allowed : '*', 300); } catch (e3) {}
  }
  return allowed;
}
