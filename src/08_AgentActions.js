/**
 * AI write actions: every change the in-app assistant or the Claude connector (MCP) may propose,
 * each defined once with its tool definition and its behaviour.
 *
 * One definition (the key is the tool name):
 *   label        short Korean name shown on the proposal card
 *   progress     step label the chat panel shows while the tool is prepared; ends in " 중"
 *   description  what the model reads about the tool
 *   parameters   JSON schema of the arguments, sent to the model as is
 *   surfaces     where the tool is offered: 'assistant' and/or 'mcp' (default ['mcp'])
 *   destructive  false for tools that only add (default: destructive)
 *   limits       { arrayParam: counter word (명, 건, 개) } for each top-level array with maxItems;
 *                longer inputs are refused before preview runs
 *   preview(svc, args)    validates without writing; returns { args, target, before, after, text }
 *   run(svc, args)        performs the change through a service function
 *   verify(svc, args, ran) reads the stored data back; returns { ok, after }
 * svc is { table, api, assignments, examPeriods }: assignments is the class assignment module
 * (02_Assignments.js) and examPeriods the exam period module (09_ExamPeriods.js); previews ask their
 * queries and check.* instead of repeating their rules. Errors carry a Korean message
 * meant for the teacher (and the model).
 * A definition with a missing or inconsistent piece throws when it is defined (at load).
 *
 * The area files (src/agent-actions/) each export their definitions; lib/agent-tools.js turns
 * the list into OpenAI, Anthropic and MCP tool definitions.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./00_Core.js');
}

/** Most students / rows / classes / titles one write call may carry (about a large class). */
LMS.AGENT_BATCH_MAX = 50;
/** Homework checks are students × items, so one class's full check-off needs more room. */
LMS.AGENT_CHECKS_MAX = 300;
LMS.AGENT_SURFACES = ['assistant', 'mcp'];

/** Schema pieces many tools share (lib/mcp-tools/shared.js hands them to the read tools too). */
LMS.AGENT_PARAM = {
  studentId: { type: 'string', description: '학생 ID (예: STU-0001). search_students로 먼저 찾습니다.' },
  classId: { type: 'string', description: '반 ID (list_classes로 찾음)' },
  date: function (what) { return { type: 'string', description: what + ' (YYYY-MM-DD)' }; },
  month: function (what) { return { type: 'string', description: what + ' (YYYY-MM)' }; }
};

/** Throws when a list holds more than max entries; unit is the counter word (명, 건, 개). */
LMS.assertAgentBatch = function (list, unit, max) {
  max = max || LMS.AGENT_BATCH_MAX;
  if (Array.isArray(list) && list.length > max) {
    throw new Error('한 번에 ' + max + unit + '까지 넣을 수 있습니다. 나눠서 요청해 주세요.');
  }
};

LMS.agentStudentName = function (table, studentId) {
  var s = LMS.findById(table('Students'), 'student_id', studentId);
  return s ? LMS.toStr(s.name) : LMS.toStr(studentId);
};

LMS.agentClassName = function (table, classId) {
  var c = LMS.findById(table('Classes'), 'class_id', classId);
  return c ? LMS.toStr(c.class_name) : LMS.toStr(classId);
};

/**
 * An empty registry: define(definitions) adds actions; get(name) → definition (throws for an
 * unknown name); list() → definitions in definition order; preview(svc, name, args) and
 * apply(svc, name, args) → { ok, after } (re-checks against the current data, runs, reads back).
 */
LMS.createAgentActions = function () {
  var byName = {};
  var order = [];

  function fail(name, why) {
    throw new Error('Agent write action ' + name + ': ' + why);
  }

  function isText(v) {
    return typeof v === 'string' && v.trim() !== '';
  }

  function checkDefinition(name, d) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) fail(name, 'name must be snake_case');
    if (Object.prototype.hasOwnProperty.call(byName, name)) fail(name, 'defined twice');
    if (!d || typeof d !== 'object') fail(name, 'definition missing');
    ['label', 'progress', 'description'].forEach(function (k) {
      if (!isText(d[k])) fail(name, k + ' missing');
    });
    if (!/ 중$/.test(d.progress)) fail(name, 'progress must end in " 중"');
    ['preview', 'run', 'verify'].forEach(function (k) {
      if (typeof d[k] !== 'function') fail(name, k + '() missing');
    });
    var p = d.parameters;
    if (!p || p.type !== 'object' || !p.properties || typeof p.properties !== 'object') fail(name, 'parameters must be an object schema');
    (p.required || []).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(p.properties, k)) fail(name, 'required ' + k + ' is not a parameter');
    });
    var surfaces = d.surfaces === undefined ? ['mcp'] : d.surfaces;
    if (!Array.isArray(surfaces) || !surfaces.length || !surfaces.every(function (s) { return LMS.AGENT_SURFACES.indexOf(s) !== -1; })) {
      fail(name, 'surfaces must list ' + LMS.AGENT_SURFACES.join(' and/or '));
    }
    if (d.destructive !== undefined && typeof d.destructive !== 'boolean') fail(name, 'destructive must be true or false');
    var limits = d.limits || {};
    Object.keys(limits).forEach(function (k) {
      var prop = p.properties[k];
      if (!prop || prop.type !== 'array' || !(prop.maxItems > 0)) fail(name, 'limit ' + k + ' needs an array parameter with maxItems');
      if (!isText(limits[k])) fail(name, 'limit ' + k + ' needs a counter word');
    });
    Object.keys(p.properties).forEach(function (k) {
      var prop = p.properties[k];
      if (prop && prop.type === 'array' && prop.maxItems !== undefined && !limits[k]) fail(name, 'array ' + k + ' has maxItems but no limit');
    });
    return surfaces;
  }

  function define(definitions) {
    Object.keys(definitions || {}).forEach(function (name) {
      var d = definitions[name];
      var surfaces = checkDefinition(name, d);
      byName[name] = Object.assign({}, d, { name: name, surfaces: surfaces.slice(), destructive: d.destructive !== false, limits: Object.assign({}, d.limits) });
      order.push(name);
    });
  }

  function get(name) {
    var key = LMS.toStr(name);
    if (!Object.prototype.hasOwnProperty.call(byName, key)) throw new Error('지원하지 않는 변경입니다: ' + key);
    return byName[key];
  }

  function list() {
    return order.map(function (name) { return byName[name]; });
  }

  function preview(svc, name, args) {
    var d = get(name);
    var input = args || {};
    Object.keys(d.limits).forEach(function (k) {
      LMS.assertAgentBatch(input[k], d.limits[k], d.parameters.properties[k].maxItems);
    });
    return d.preview(svc, input);
  }

  function apply(svc, name, args) {
    var d = get(name);
    var checked = preview(svc, name, args);
    var ran = d.run(svc, checked.args);
    return d.verify(svc, checked.args, ran);
  }

  return { define: define, get: get, list: list, preview: preview, apply: apply };
};

LMS.agentActions = LMS.createAgentActions();

// Literal paths, so the server bundle's file tracing finds every area file.
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS.agentActions.define(require('./agent-actions/students.js'));
  LMS.agentActions.define(require('./agent-actions/classes.js'));
  LMS.agentActions.define(require('./agent-actions/lessons.js'));
  LMS.agentActions.define(require('./agent-actions/homework.js'));
  LMS.agentActions.define(require('./agent-actions/schedule.js'));
  LMS.agentActions.define(require('./agent-actions/tasks.js'));
  LMS.agentActions.define(require('./agent-actions/plans.js'));
  LMS.agentActions.define(require('./agent-actions/exams.js'));
  LMS.agentActions.define(require('./agent-actions/reports.js'));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
