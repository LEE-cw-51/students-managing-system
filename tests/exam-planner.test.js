'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../lib/exam-planner.js');
const { OUT, classNameKey, mergeTargets, studentEndDate } = planner;

describe('exports', () => {
  it('keeps the out marker and drops the group toggles', () => {
    assert.equal(typeof OUT, 'string');
    assert.equal(planner.excludeGroup, undefined);
    assert.equal(planner.includeGroup, undefined);
  });
});

describe('studentEndDate', () => {
  const cls = { start_date: '2026-11-02', end_date: '2026-11-20' };

  it('uses the school exam date when it falls inside the class range', () => {
    assert.equal(studentEndDate({ exam_date: '2026-11-11' }, cls), '2026-11-11');
    assert.equal(studentEndDate({ exam_date: '2026-11-02' }, cls), '2026-11-02', 'start edge');
    assert.equal(studentEndDate({ exam_date: '2026-11-20' }, cls), '2026-11-20', 'end edge');
  });

  it('falls back to the class end when the exam is outside the range', () => {
    assert.equal(studentEndDate({ exam_date: '2026-11-25' }, cls), '2026-11-20');
    assert.equal(studentEndDate({ exam_date: '2026-11-01' }, cls), '2026-11-20');
  });

  it('falls back to the class end when there is no exam date', () => {
    assert.equal(studentEndDate({ exam_date: '' }, cls), '2026-11-20');
    assert.equal(studentEndDate({}, cls), '2026-11-20');
    assert.equal(studentEndDate(undefined, cls), '2026-11-20');
    assert.equal(studentEndDate({ exam_date: '2026-11-11' }, undefined), '2026-11-11', 'no class range to check');
  });
});

describe('classNameKey', () => {
  it('trims and collapses whitespace', () => {
    assert.equal(classNameKey('  중2   연합반 '), '중2 연합반');
    assert.equal(classNameKey('중2\t연합반'), '중2 연합반');
    assert.equal(classNameKey(null), '');
  });
});

describe('mergeTargets', () => {
  const g = (class_name, extra = {}) => ({ include: true, class_name, students: [{ student_id: class_name }], ...extra });

  it('points later same-name groups at the first one', () => {
    const groups = [g('연합반'), g('다른반'), g(' 연합반 '), g('연합  반'), g('연합반')];
    assert.deepEqual(mergeTargets(groups), [-1, -1, 0, -1, 0]);
  });

  it('never merges excluded, empty or unnamed groups', () => {
    const groups = [
      g('연합반', { include: false }),
      g('연합반', { students: [] }),
      g('연합반'),
      g('연합반', { include: false }),
      g('연합반'),
      g('  '),
      g('')
    ];
    assert.deepEqual(mergeTargets(groups), [-1, -1, -1, -1, 2, -1, -1]);
  });

  it('handles a missing list', () => {
    assert.deepEqual(mergeTargets(undefined), []);
  });
});
