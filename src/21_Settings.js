/**
 * Workspace settings (Settings rows): read map, merge-save, single-key save.
 * Owns Settings table writes and mcp_write_mode normalization on save.
 * Server-only: reads tables.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/**
 * ctx: table, saveTable.
 * Callers run commands inside the service transaction.
 */
LMS.createSettings = function (ctx) {
  var table = ctx.table;
  var saveTable = ctx.saveTable;

  function settings() {
    return LMS.settingsFromRows(table('Settings'));
  }

  function getSettings() {
    return settings();
  }

  function saveSettings(map) {
    var current = settings();
    var storedMode = current.mcp_write_mode;
    Object.keys(map || {}).forEach(function (k) {
      current[k] = map[k];
    });
    current.mcp_write_mode = LMS.mcpWriteModeToStore(map, storedMode);
    saveTable('Settings', LMS.settingsToRows(current));
    return current;
  }

  function saveSetting(key, value) {
    var obj = {};
    obj[key] = value;
    return saveSettings(obj);
  }

  return {
    settings: settings,
    getSettings: getSettings,
    saveSettings: saveSettings,
    saveSetting: saveSetting
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
