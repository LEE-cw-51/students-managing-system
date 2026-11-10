'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const LMS = require('../src/01_Service.js');
const { APPROVAL_TAG, readWriteMode, writePolicy } = require('../lib/write-policy.js');
const { getAgentTool, offeredTools } = require('../lib/agent-tools.js');
const { buildSystemPrompt } = require('../lib/agent.js');

const tool = (kind, surfaces, description = '설명입니다.') => ({ name: 't', kind, surfaces, description });
const READ_BOTH = tool('read', ['assistant', 'mcp']);
const WRITE_BOTH = tool('write', ['assistant', 'mcp'], '출결을 바꿉니다.');
const WRITE_MCP = tool('write', ['mcp'], '할 일을 만듭니다.');

describe('write policy: modes', () => {
  it('reads stored values for mcp: legacy direct and claude_approve are proposal, anything else read_only', () => {
    const table = {
      read_only: 'read_only',
      proposal: 'proposal',
      ' proposal ': 'proposal',
      direct: 'proposal',
      claude_approve: 'proposal',
      ' claude_approve ': 'proposal',
      DIRECT: 'read_only',
      write: 'read_only',
      '': 'read_only'
    };
    Object.entries(table).forEach(([stored, mode]) => assert.equal(writePolicy('mcp', stored).mode, mode, stored));
    [null, undefined].forEach((v) => assert.equal(writePolicy('mcp', v).mode, 'read_only'));
  });

  it('the assistant has no mode: always proposal', () => {
    ['read_only', '', undefined, 'direct'].forEach((m) => assert.equal(writePolicy('assistant', m).mode, 'proposal'));
  });

  it('rejects an unknown surface', () => {
    assert.throws(() => writePolicy('slack', 'proposal'), /Unknown AI surface/);
    assert.throws(() => writePolicy('__proto__', 'proposal'), /Unknown AI surface/);
  });

  it('reads the mode from Settings through run', async () => {
    const run = (value) => async (fn) => fn({ getSettings: () => ({ mcp_write_mode: value }) });
    assert.equal(await readWriteMode(run('claude_approve')), 'proposal');
    assert.equal(await readWriteMode(run('nonsense')), 'read_only');
  });
});

describe('write policy: tools', () => {
  it('offers reads in every mode, writes only outside read_only, and only on their own surface', () => {
    const ro = writePolicy('mcp', 'read_only');
    const p = writePolicy('mcp', 'proposal');
    const a = writePolicy('assistant');
    assert.equal(ro.offers(READ_BOTH), true);
    assert.equal(ro.offers(WRITE_BOTH), false);
    assert.equal(p.offers(WRITE_BOTH), true);
    assert.equal(p.offers(WRITE_MCP), true);
    assert.equal(a.offers(WRITE_BOTH), true);
    assert.equal(a.offers(WRITE_MCP), false);
    [ro, p, a].forEach((policy) => {
      assert.equal(policy.offers(null), false);
      assert.equal(policy.offers(tool('approve', ['assistant', 'mcp'])), false);
    });
  });

  it('tags write descriptions once; mcp also says approval happens in the app', () => {
    assert.equal(writePolicy('assistant').describe(WRITE_BOTH), '[승인 필요] 출결을 바꿉니다.');
    assert.equal(writePolicy('mcp', 'proposal').describe(WRITE_MCP), '[승인 필요] 할 일을 만듭니다. 바로 저장되지 않고, 강사가 앱의 AI 비서에서 승인해야 반영됩니다.');
    assert.equal(writePolicy('mcp', 'proposal').describe(READ_BOTH), READ_BOTH.description);
    LMS.agentActions.list().forEach((a) => assert.ok(!a.description.includes(APPROVAL_TAG), a.name));
  });

  it('offeredTools follows the policy for real tools', () => {
    const names = (surface, mode) => offeredTools(surface, mode).map((t) => t.name);
    assert.ok(names('mcp', 'read_only').every((n) => getAgentTool(n).kind === 'read'));
    assert.ok(names('mcp', 'proposal').includes('create_task'));
    assert.ok(!names('assistant').includes('create_task'));
    offeredTools('assistant').filter((t) => t.kind === 'write').forEach((t) => {
      assert.equal(t.description, `${APPROVAL_TAG} ${getAgentTool(t.name).description}`, t.name);
    });
  });
});

describe('write policy: wording', () => {
  it('queued status and prompt rules per surface, the same in every mcp mode', () => {
    assert.equal(writePolicy('assistant').queued, '승인 대기에 추가했습니다. 아직 저장되지 않았습니다.');
    assert.match(writePolicy('mcp', 'proposal').queued, /앱의 AI 비서에서 승인하면 반영됩니다\.$/);
    assert.equal(writePolicy('mcp', 'read_only').rules, writePolicy('mcp', 'proposal').rules);
    assert.match(writePolicy('mcp').rules, /승인과 거절은 강사가 앱 화면에서만/);
    assert.match(writePolicy('assistant').rules, /\[승인 필요\] 도구로만 요청합니다/);
  });

  it('the assistant system prompt carries the assistant rules', () => {
    const prompt = buildSystemPrompt({ today: '2026-11-10', weekday: '화', today_classes: [] });
    assert.ok(prompt.includes(writePolicy('assistant').rules));
  });
});

describe('mcpWriteModeToStore (saveSettings)', () => {
  const save = (submitted, stored) => LMS.mcpWriteModeToStore(submitted, stored);

  it('maps legacy and blank values, keeps a resent unknown value out, rejects new unknown ones', () => {
    assert.equal(save({ mcp_write_mode: 'proposal' }, 'read_only'), 'proposal');
    assert.equal(save({ mcp_write_mode: ' proposal ' }, 'read_only'), 'proposal');
    assert.equal(save({ mcp_write_mode: 'direct' }, 'read_only'), 'proposal');
    assert.equal(save({ mcp_write_mode: 'claude_approve' }, 'read_only'), 'proposal');
    assert.equal(save({ mcp_write_mode: '' }, 'proposal'), 'read_only');
    assert.equal(save({ mcp_write_mode: 'write' }, 'write'), 'read_only');
    ['write', 'DIRECT'].forEach((v) => assert.throws(() => save({ mcp_write_mode: v }, 'proposal'), /조회만\(read_only\), 승인 대기 제안\(proposal\) 중에서만/));
  });

  it('without the key: rewrites a stored legacy value, keeps anything else', () => {
    assert.equal(save({ contact: '010' }, 'claude_approve'), 'proposal');
    assert.equal(save({}, 'direct'), 'proposal');
    assert.equal(save(undefined, 'direct'), 'proposal');
    assert.equal(save({ contact: '010' }, 'proposal'), 'proposal');
    assert.equal(save({ contact: '010' }, 'write'), 'write');
  });
});
