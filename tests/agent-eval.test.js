'use strict';

/**
 * Phase A3 eval gate: Korean utterance fixtures × name resolve × assistant tools.
 * No live model in CI. Set LIVE_AGENT_EVAL=1 locally to run the optional live smoke (skipped here).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { assistantTools } = require('../lib/agent-tools.js');
const { seedEval } = require('./agent-eval/seed.js');
const fixtures = require('./agent-eval/fixtures.js');
const { resolveStudentMention, assertFixtureShape } = require('./agent-eval/resolve.js');

const ASSISTANT_NAMES = new Set(assistantTools().map((t) => t.name));
const WRITE_NAMES = new Set(assistantTools().filter((t) => t.kind === 'write').map((t) => t.name));

function classIdFor(env, className) {
  if (!className) return '';
  const want = String(className).replace(/\s+/g, '');
  return Object.values(env.classes).find((c) => String(c.class_name).replace(/\s+/g, '').includes(want))?.class_id || '';
}

function resolveFixture(env, fx) {
  if (fx.class_only) {
    return { status: 'none', students: [] };
  }
  return resolveStudentMention(env.api, {
    query: fx.query,
    className: fx.class_name,
    schoolHint: fx.school_hint,
    aliases: env.aliases,
    studentsByKey: env.students
  });
}

/** Build preview args for the primary write tool using resolved roster ids. */
function previewArgs(env, fx, tool, resolved) {
  const base = Object.assign({}, fx.expect.args || {});
  const today = env.today;
  if (tool === 'update_attendance') {
    const lesson = env.lessonOf(fx.expect.student);
    assert.ok(lesson, fx.id + ': needs an existing lesson');
    return { lesson_id: lesson.lesson_id, attendance: base.attendance || '결석' };
  }
  if (tool === 'update_lesson') {
    const lesson = env.lessonOf(fx.expect.student);
    assert.ok(lesson, fx.id + ': needs an existing lesson');
    return Object.assign({ lesson_id: lesson.lesson_id }, base);
  }
  if (tool === 'save_lesson') {
    const s = env.students[fx.expect.student];
    const cid = classIdFor(env, fx.class_name) || env.classes.A.class_id;
    return Object.assign({
      student_id: s.student_id,
      class_id: cid,
      lesson_date: today
    }, base);
  }
  if (tool === 'save_class_session') {
    const cid = classIdFor(env, fx.class_name) || env.classes.A.class_id;
    const session = fx.expect.session_args || base;
    return Object.assign({ class_id: cid, lesson_date: today }, session);
  }
  if (tool === 'create_counseling') {
    return Object.assign({
      student_id: resolved.student_id,
      counsel_date: today,
      kind: '학생',
      content: '상담'
    }, base);
  }
  if (tool === 'update_task_status') {
    return null; // no open task in seed — surface check only
  }
  return base;
}

describe('agent-eval fixtures', () => {
  it('has about 40 Korean utterances with a complete expect shape', () => {
    assert.ok(fixtures.length >= 40, 'need ≥40 fixtures, got ' + fixtures.length);
    fixtures.forEach(assertFixtureShape);
    const ids = fixtures.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, 'fixture ids must be unique');
  });

  it('covers name variants, homonyms, class context, clarify, and A1 tools', () => {
    const tags = {
      omit: fixtures.filter((f) => f.id.startsWith('omit-')).length,
      homo: fixtures.filter((f) => f.expect.clarify && f.expect.resolve === 'ambiguous').length,
      class: fixtures.filter((f) => f.class_name && f.expect.resolve === 'unique').length,
      none: fixtures.filter((f) => f.expect.resolve === 'none' && f.expect.clarify).length,
      a1: fixtures.filter((f) => f.expect.tools.some((t) => ['save_lesson', 'update_lesson', 'save_class_session'].includes(t))).length
    };
    assert.ok(tags.omit >= 4, '성 생략');
    assert.ok(tags.homo >= 3, '동명이인 되묻기');
    assert.ok(tags.class >= 2, '반 맥락 해소');
    assert.ok(tags.none >= 2, '없음 되묻기');
    assert.ok(tags.a1 >= 8, 'A1 tool combos');
  });
});

describe('agent-eval resolve gate', () => {
  const env = seedEval();

  fixtures.forEach((fx) => {
    it(fx.id + ': ' + fx.utterance, () => {
      const got = resolveFixture(env, fx);
      assert.equal(got.status, fx.expect.resolve, fx.id + ' resolve');

      if (fx.expect.resolve === 'unique') {
        assert.equal(got.student_id, env.students[fx.expect.student].student_id, fx.id + ' student_id');
        assert.equal(Boolean(fx.expect.clarify), false);
      } else if (fx.expect.clarify) {
        assert.ok(got.status === 'ambiguous' || got.status === 'none', fx.id + ' clarify');
        assert.deepEqual(fx.expect.tools, []);
      }

      fx.expect.tools.forEach((name) => {
        assert.ok(ASSISTANT_NAMES.has(name), fx.id + ': tool not on assistant surface: ' + name);
      });

      // Primary write: re-preview with resolved ids (same path apply uses).
      const writes = fx.expect.tools.filter((t) => WRITE_NAMES.has(t));
      writes.forEach((tool) => {
        if (tool === 'update_task_status') return;
        const args = previewArgs(env, fx, tool, got);
        if (!args) return;
        // Isolated preview on a fresh service view of the same store.
        const preview = env.api.previewAgentAction(tool, args);
        assert.equal(typeof preview.text, 'string', fx.id + ' ' + tool);
        assert.ok(preview.text, fx.id + ' ' + tool + ' empty preview');
      });
    });
  });
});

describe('agent-eval live (optional)', () => {
  it('is skipped unless LIVE_AGENT_EVAL=1', { skip: process.env.LIVE_AGENT_EVAL !== '1' }, async () => {
    assert.fail('wire a local live turn here when LIVE_AGENT_EVAL=1');
  });
});
