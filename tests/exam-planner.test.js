'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../lib/exam-planner.js');
const { OUT, classNameKey, studentEndDate } = planner;

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
