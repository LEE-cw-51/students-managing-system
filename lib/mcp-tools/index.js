/**
 * MCP-only tools (Claude connector), one file per area. Same entry shape as agent-tools.js;
 * agent-tools.js adds kind and surfaces ['mcp']. Read entries need call(api, args); write
 * entries need a matching LMS.AGENT_WRITE_ACTIONS action (src/agent-actions/); approval
 * entries need call(ctx, args) (see approval.js).
 */
import { READ_CLASS_TOOLS } from './read-classes.js';
import { READ_SCHEDULE_TOOLS } from './read-schedule.js';
import { READ_EXAM_TOOLS } from './read-exams.js';
import { READ_REPORT_TOOLS } from './read-reports.js';
import { READ_MISC_TOOLS } from './read-misc.js';
import { WRITE_STUDENT_TOOLS } from './write-students.js';
import { WRITE_CLASS_TOOLS } from './write-classes.js';
import { WRITE_LESSON_TOOLS } from './write-lessons.js';
import { WRITE_HOMEWORK_TOOLS } from './write-homework.js';
import { WRITE_SCHEDULE_TOOLS } from './write-schedule.js';
import { WRITE_TASK_TOOLS } from './write-tasks.js';
import { WRITE_PLAN_TOOLS } from './write-plans.js';
import { WRITE_EXAM_TOOLS } from './write-exams.js';
import { WRITE_REPORT_TOOLS } from './write-reports.js';
import { APPROVAL_TOOLS } from './approval.js';

export const MCP_READ_TOOLS = [
  ...READ_CLASS_TOOLS,
  ...READ_SCHEDULE_TOOLS,
  ...READ_EXAM_TOOLS,
  ...READ_REPORT_TOOLS,
  ...READ_MISC_TOOLS
];

export const MCP_WRITE_TOOLS = [
  ...WRITE_STUDENT_TOOLS,
  ...WRITE_CLASS_TOOLS,
  ...WRITE_LESSON_TOOLS,
  ...WRITE_HOMEWORK_TOOLS,
  ...WRITE_SCHEDULE_TOOLS,
  ...WRITE_TASK_TOOLS,
  ...WRITE_PLAN_TOOLS,
  ...WRITE_EXAM_TOOLS,
  ...WRITE_REPORT_TOOLS
];

/** Approve or reject pending proposals from Claude; only in the claude_approve mode. */
export const MCP_APPROVAL_TOOLS = APPROVAL_TOOLS;
