/**
 * Google Sheets store: batch getValues/setValues, LockService, CacheService.
 */
var LMS = LMS || {};

function createSheetStore_() {
  var CACHEABLE = { Settings: true, Classes: true };
  var cacheTtl = 120;

  function cache() {
    try { return CacheService.getScriptCache(); } catch (e) { return null; }
  }

  function cacheKey(name) {
    return 'lms_table_' + name;
  }

  function invalidate(name) {
    var c = cache();
    if (!c) return;
    if (name) c.remove(cacheKey(name));
    else {
      c.remove(cacheKey('Settings'));
      c.remove(cacheKey('Classes'));
    }
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
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SPREADSHEET_ID');
    var ss;
    if (id) {
      ss = SpreadsheetApp.openById(id);
    } else {
      ss = SpreadsheetApp.create('수학의힘_LMS_DB');
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
    ensureSchema_(ss);
    return ss;
  }

  function sheetByName(ss, name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
    }
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
        sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), headers.length).setNumberFormat('@');
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
    var range = sh.getDataRange();
    var values = range.getValues();
    if (!values.length) return [];
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
    if (!rows.length) return;
    var values = rows.map(function (row) {
      return headers.map(function (h) {
        var v = row[h];
        return v === undefined || v === null ? '' : v;
      });
    });
    sh.getRange(2, 1, values.length, headers.length).setValues(values);
  }

  function readTable(name) {
    if (CACHEABLE[name]) {
      var c = cache();
      if (c) {
        var hit = c.get(cacheKey(name));
        if (hit) {
          try { return JSON.parse(hit); } catch (e) {}
        }
      }
    }
    var ss = getSpreadsheet();
    var sh = sheetByName(ss, name);
    var rows = readRows_(sh, LMS.TABLES[name]);
    if (CACHEABLE[name]) {
      var c2 = cache();
      if (c2) {
        try { c2.put(cacheKey(name), JSON.stringify(rows), cacheTtl); } catch (e2) {}
      }
    }
    return rows;
  }

  function writeTable(name, rows) {
    var ss = getSpreadsheet();
    var sh = sheetByName(ss, name);
    writeRows_(sh, LMS.TABLES[name], rows || []);
    invalidate(name);
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

function getService_() {
  return LMS.createService(createSheetStore_());
}
