/**
 * MCP-only read and approval tools (Claude connector), one file per area. Same entry shape as
 * agent-tools.js; agent-tools.js adds kind and surfaces ['mcp']. Read entries need
 * call(api, args); approval entries need call(ctx, args) (see approval.js). Write tools are
 * write actions (src/08_AgentActions.js), whose surfaces say where they are offered.
 */
import { READ_CLASS_TOOLS } from './read-classes.js';
import { READ_SCHEDULE_TOOLS } from './read-schedule.js';
import { READ_EXAM_TOOLS } from './read-exams.js';
import { READ_REPORT_TOOLS } from './read-reports.js';
import { READ_MISC_TOOLS } from './read-misc.js';
import { APPROVAL_TOOLS } from './approval.js';

export const MCP_READ_TOOLS = [
  ...READ_CLASS_TOOLS,
  ...READ_SCHEDULE_TOOLS,
  ...READ_EXAM_TOOLS,
  ...READ_REPORT_TOOLS,
  ...READ_MISC_TOOLS
];

/** Approve or reject pending proposals from Claude; only in the claude_approve mode. */
export const MCP_APPROVAL_TOOLS = APPROVAL_TOOLS;
