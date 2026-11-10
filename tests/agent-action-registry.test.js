'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const LMS = require('../src/01_Service.js');
const { createMemoryStore, seedDemo } = require('./memory-store.js');
const { toolDefinitions } = require('../lib/agent-tools.js');
const { anthropicToolDefinitions } = require('../lib/agent-anthropic.js');
const { listTools } = require('../lib/mcp-server.js');

const HANGUL = /[가-힣]/;

function action(extra) {
  return {
    label: '시험',
    progress: '시험 준비 중',
    description: '시험용 action',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', maxItems: 2, items: { type: 'string' } }, memo: { type: 'string' } },
      required: ['ids']
    },
    limits: { ids: '개' },
    preview: (svc, args) => ({ args, target: {}, before: '', after: '', text: 'ok' }),
    run: () => ({}),
    verify: () => ({ ok: true, after: '' }),
    ...extra
  };
}

/** A registry with one action, or the error defining it threw. */
function defineOne(def, name = 'try_action') {
  const registry = LMS.createAgentActions();
  registry.define({ [name]: def });
  return registry;
}

const untouchedSvc = { table: () => { throw new Error('touched a table'); }, api: {} };

describe('agent write action registry: definitions', () => {
  it('accepts a complete definition and fills in the defaults', () => {
    const registry = defineOne(action());
    const a = registry.get('try_action');
    assert.equal(a.name, 'try_action');
    assert.deepEqual(a.surfaces, ['mcp']);
    assert.equal(a.destructive, true);
    assert.equal(defineOne(action({ destructive: false })).get('try_action').destructive, false);
    assert.deepEqual(registry.list().map((x) => x.name), ['try_action']);
  });

  it('refuses a missing or inconsistent piece when the action is defined', () => {
    const props = action().parameters.properties;
    const broken = {
      'no label': { label: '' },
      'no progress': { progress: undefined },
      'progress without 중': { progress: '시험 준비' },
      'no description': { description: ' ' },
      'no preview': { preview: undefined },
      'no run': { run: 'run' },
      'no verify': { verify: undefined },
      'not an object schema': { parameters: { type: 'array', properties: {} } },
      'required not a parameter': { parameters: { type: 'object', properties: props, required: ['nope'] } },
      'limit on a non-array': { limits: { ids: '개', memo: '개' } },
      'limit without a counter word': { limits: { ids: '' } },
      'maxItems without a limit': { limits: {} },
      'unknown surface': { surfaces: ['web'] },
      'empty surfaces': { surfaces: [] },
      'destructive not boolean': { destructive: 'yes' }
    };
    Object.entries(broken).forEach(([why, extra]) => {
      assert.throws(() => defineOne(action(extra)), /Agent write action try_action: /, why);
    });
    assert.throws(() => defineOne(action(), 'TryAction'), /snake_case/);
    const registry = defineOne(action());
    assert.throws(() => registry.define({ try_action: action() }), /defined twice/);
  });

  it('every registered action defines a complete tool on each of its surfaces', () => {
    const all = LMS.agentActions.list();
    assert.equal(all.length, 49);
    assert.equal(new Set(all.map((a) => a.name)).size, all.length);
    all.forEach((a) => {
      Object.keys(a.limits).forEach((k) => assert.ok(a.parameters.properties[k].maxItems > 0, a.name + '.' + k));
      assert.ok(a.surfaces.includes('mcp'), a.name);
    });
  });
});

describe('agent write action registry: preview and apply', () => {
  it('refuses unknown names with a Korean message', () => {
    assert.throws(() => LMS.agentActions.get('drop_tables'), /지원하지 않는 변경입니다: drop_tables/);
    assert.throws(() => LMS.agentActions.preview(untouchedSvc, 'drop_tables', {}), /지원하지 않는 변경입니다/);
  });

  it('apply re-checks with preview, runs the checked args and reads them back', () => {
    const calls = [];
    const registry = defineOne(action({
      preview: (svc, args) => { calls.push(['preview', args]); return { args: { ids: args.ids, checked: true }, target: {}, before: '', after: '', text: 'ok' }; },
      run: (svc, args) => { calls.push(['run', args]); return { id: 'X-1' }; },
      verify: (svc, args, ran) => { calls.push(['verify', args, ran]); return { ok: true, after: ran.id }; }
    }));
    assert.deepEqual(registry.apply(untouchedSvc, 'try_action', { ids: ['a'] }), { ok: true, after: 'X-1' });
    const checked = { ids: ['a'], checked: true };
    assert.deepEqual(calls, [['preview', { ids: ['a'] }], ['run', checked], ['verify', checked, { id: 'X-1' }]]);
  });

  it('every limited parameter refuses more than maxItems before the preview reads any row', () => {
    let limited = 0;
    LMS.agentActions.list().forEach((a) => {
      Object.keys(a.limits).forEach((k) => {
        limited++;
        const max = a.parameters.properties[k].maxItems;
        const over = { [k]: Array.from({ length: max + 1 }, (_, i) => 'X-' + i) };
        assert.throws(() => LMS.agentActions.preview(untouchedSvc, a.name, over), new RegExp('한 번에 ' + max + a.limits[k] + '까지'), a.name);
      });
    });
    assert.equal(limited, 9);
  });

  it('every registered action answers empty input with a proposal or a Korean error, never a crash', () => {
    const store = createMemoryStore();
    seedDemo(LMS.createService(store));
    LMS.agentActions.list().forEach((a) => {
      let out;
      try {
        out = LMS.createService(store).previewAgentAction(a.name, {});
      } catch (e) {
        assert.ok(!(e instanceof TypeError) && !(e instanceof ReferenceError), a.name + ': ' + e.stack);
        assert.match(e.message, HANGUL, a.name);
        return;
      }
      assert.equal(typeof out.text, 'string', a.name);
      assert.ok(out.text, a.name);
      assert.equal(typeof out.args, 'object', a.name);
    });
  });
});

describe('agent write action registry: adapters', () => {
  it('Claude (MCP) sees every action with its own schema and destructive flag', () => {
    const tools = new Map(listTools('proposal').map((t) => [t.name, t]));
    LMS.agentActions.list().forEach((a) => {
      const t = tools.get(a.name);
      assert.ok(t, a.name);
      assert.equal(t.inputSchema, a.parameters, a.name);
      assert.equal(t.annotations.destructiveHint, a.destructive, a.name);
      assert.ok(t.description.includes(a.description.replace(/^\[승인 필요\]\s*/, '')), a.name);
    });
    assert.ok(listTools('read_only').every((t) => !LMS.agentActions.list().some((a) => a.name === t.name)));
  });

  it('the in-app assistant gets exactly the actions on its surface, in OpenAI and Anthropic form', () => {
    const shared = LMS.agentActions.list().filter((a) => a.surfaces.includes('assistant'));
    assert.deepEqual(shared.map((a) => a.name), ['update_attendance', 'create_counseling', 'update_task_status']);
    const openAi = new Map(toolDefinitions().map((d) => [d.function.name, d.function]));
    const anthropic = new Map(anthropicToolDefinitions().map((d) => [d.name, d]));
    LMS.agentActions.list().forEach((a) => {
      const offered = a.surfaces.includes('assistant');
      assert.equal(openAi.has(a.name), offered, a.name);
      assert.equal(anthropic.has(a.name), offered, a.name);
      if (!offered) return;
      assert.equal(openAi.get(a.name).parameters, a.parameters);
      assert.equal(openAi.get(a.name).description, a.description);
      assert.equal(anthropic.get(a.name).input_schema, a.parameters);
    });
  });
});
