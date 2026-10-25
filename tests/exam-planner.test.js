'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { OUT, excludeGroup, includeGroup } = require('../lib/exam-planner.js');

function groupsFixture() {
  return [
    {
      key: 'hanbit-m2',
      include: true,
      class_name: '한빛중 중2 시험대비',
      students: [
        { student_id: 'S1', name: '김민준', source_class_id: 'C1' },
        { student_id: 'S2', name: '이서연', source_class_id: 'C1' }
      ]
    },
    {
      key: 'pureun-m2',
      include: true,
      class_name: '푸른중 중2 시험대비',
      students: [{ student_id: 'S3', name: '박지호', source_class_id: 'C1' }]
    }
  ];
}

describe('excludeGroup', () => {
  it('moves the group roster into the unassigned pool and clears students', () => {
    const pool = [{ student_id: 'S0', name: '윤지우', target: OUT }];
    const next = excludeGroup(groupsFixture(), pool, 0);
    assert.equal(next.groups[0].include, false);
    assert.deepEqual(next.groups[0].students, []);
    assert.equal(next.groups[1].include, true);
    assert.deepEqual(next.pool.map((p) => p.student_id), ['S0', 'S1', 'S2']);
    assert.ok(next.pool.every((p) => p.target === OUT));
  });

  it('skips students already in the pool', () => {
    const groups = groupsFixture();
    const pool = [{ student_id: 'S1', name: '김민준', target: OUT }];
    const next = excludeGroup(groups, pool, 0);
    assert.deepEqual(next.pool.map((p) => p.student_id), ['S1', 'S2']);
  });
});

describe('includeGroup', () => {
  it('re-checks the group without pulling students back from the pool', () => {
    const excluded = excludeGroup(groupsFixture(), [], 0);
    const restored = includeGroup(excluded.groups, 0);
    assert.equal(restored[0].include, true);
    assert.deepEqual(restored[0].students, []);
    assert.deepEqual(excluded.pool.map((p) => p.student_id), ['S1', 'S2']);
  });
});
