/** Marker for students left out of exam-class placement. */
export const OUT = '__out__';

/**
 * Uncheck a proposed group: clear its roster into the unassigned pool.
 * Students stay visible so applyExamGroups cannot drop them silently.
 */
export function excludeGroup(groups, pool, index) {
  const list = Array.isArray(groups) ? groups : [];
  const basePool = Array.isArray(pool) ? pool : [];
  if (index < 0 || index >= list.length) return { groups: list, pool: basePool };

  const moved = list[index].students || [];
  const seen = new Set(basePool.map((p) => p.student_id));
  const nextPool = basePool.slice();
  moved.forEach((s) => {
    if (!s || seen.has(s.student_id)) return;
    seen.add(s.student_id);
    nextPool.push({ ...s, target: OUT });
  });

  return {
    groups: list.map((g, j) => (j === index ? { ...g, include: false, students: [] } : g)),
    pool: nextPool
  };
}

/** Re-check a group without pulling students back from the pool. */
export function includeGroup(groups, index) {
  const list = Array.isArray(groups) ? groups : [];
  if (index < 0 || index >= list.length) return list;
  return list.map((g, j) => (j === index ? { ...g, include: true } : g));
}
