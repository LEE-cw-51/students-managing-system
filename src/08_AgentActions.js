/**
 * Loads the per-area AI write actions (src/agent-actions/) into LMS.AGENT_WRITE_ACTIONS.
 * The base actions live in 07_Agent.js; each area file calls LMS.registerAgentWriteActions.
 */
var LMS = (typeof LMS !== 'undefined') ? LMS : {};
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  LMS = require('./07_Agent.js');
  require('./agent-actions/students.js');
  require('./agent-actions/classes.js');
  require('./agent-actions/lessons.js');
  require('./agent-actions/homework.js');
  require('./agent-actions/schedule.js');
  require('./agent-actions/tasks.js');
  require('./agent-actions/plans.js');
  require('./agent-actions/exams.js');
  require('./agent-actions/reports.js');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LMS;
}
