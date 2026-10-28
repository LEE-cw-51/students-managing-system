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

/** Groups whose names share this key become one exam class. */
export function classNameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

/**
 * For each group, the index of the earlier included group with the same name key
 * (whose schedule wins), or -1. Excluded or empty groups never merge.
 */
export function mergeTargets(groups) {
  const list = Array.isArray(groups) ? groups : [];
  const first = new Map();
  return list.map((g, i) => {
    if (!g || !g.include || !(g.students || []).length) return -1;
    const key = classNameKey(g.class_name);
    if (!key) return -1;
    if (first.has(key)) return first.get(key);
    first.set(key, i);
    return -1;
  });
}

/** Re-check a group without pulling students back from the pool. */
export function includeGroup(groups, index) {
  const list = Array.isArray(groups) ? groups : [];
  if (index < 0 || index >= list.length) return list;
  return list.map((g, j) => (j === index ? { ...g, include: true } : g));
}
