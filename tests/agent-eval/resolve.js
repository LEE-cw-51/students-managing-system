'use strict';

/**
 * Name → student resolution for agent-eval (no live model).
 * Mirrors the assistant rule: search_students first; class context narrows; many/zero → clarify.
 */

function stripSpaces(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Resolve a spoken name (or alias) against the eval roster / live student list.
 * opts: { query, classId?, className?, aliases?, studentsByKey? }
 * returns { status: 'unique'|'ambiguous'|'none', students, student_id?, key? }
 */
function resolveStudentMention(api, opts) {
  opts = opts || {};
  const raw = String(opts.query || '').trim();
  if (!raw) return { status: 'none', students: [] };

  const aliases = opts.aliases || {};
  const byKey = opts.studentsByKey || {};
  if (Object.prototype.hasOwnProperty.call(aliases, raw)) {
    const key = aliases[raw];
    const s = byKey[key];
    if (!s) return { status: 'none', students: [] };
    return {
      status: 'unique',
      students: [{ student_id: s.student_id, name: s.name, key }],
      student_id: s.student_id,
      key
    };
  }

  let rows = api.getStudentList({ query: raw, status: '재원' });
  if (opts.classId) {
    rows = rows.filter((r) => (r.classes || []).some((c) => c.class_id === opts.classId));
  } else if (opts.className) {
    const want = stripSpaces(opts.className);
    rows = rows.filter((r) => (r.classes || []).some((c) => stripSpaces(c.class_name).includes(want)));
  }
  if (opts.schoolHint) {
    const school = stripSpaces(opts.schoolHint);
    rows = rows.filter((r) => stripSpaces(r.school).includes(school));
  }

  if (!rows.length) return { status: 'none', students: [] };
  if (rows.length > 1) {
    return {
      status: 'ambiguous',
      students: rows.map((r) => ({ student_id: r.student_id, name: r.name, classes: (r.classes || []).map((c) => c.class_name) }))
    };
  }
  const only = rows[0];
  let key;
  Object.keys(byKey).forEach((k) => {
    if (byKey[k].student_id === only.student_id) key = k;
  });
  return {
    status: 'unique',
    students: [{ student_id: only.student_id, name: only.name, key }],
    student_id: only.student_id,
    key
  };
}

/**
 * Pick the write/read tools a fixture expects and whether the teacher must clarify first.
 * Fixtures declare this; the helper only checks shape for the CI gate.
 */
function assertFixtureShape(fx) {
  if (!fx || typeof fx.id !== 'string' || typeof fx.utterance !== 'string') {
    throw new Error('fixture needs id and utterance');
  }
  const e = fx.expect || {};
  if (!['unique', 'ambiguous', 'none'].includes(e.resolve)) {
    throw new Error(fx.id + ': expect.resolve must be unique|ambiguous|none');
  }
  if (e.resolve === 'unique' && !e.student) throw new Error(fx.id + ': unique needs expect.student');
  if (e.clarify && e.resolve === 'unique') throw new Error(fx.id + ': clarify cannot be unique');
  if (!Array.isArray(e.tools)) throw new Error(fx.id + ': expect.tools must be an array');
}

module.exports = { resolveStudentMention, assertFixtureShape, stripSpaces };
