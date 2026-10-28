/** Marker for students left out of exam-class placement. */
export const OUT = '__out__';

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

/** Last exam-class day for a student: their school exam date when it falls inside the class range, else the class end. */
export function studentEndDate(student, cls) {
  const end = (cls && cls.end_date) || '';
  const exam = (student && student.exam_date) || '';
  if (!exam) return end;
  if (cls && cls.start_date && exam < cls.start_date) return end;
  if (end && exam > end) return end;
  return exam;
}
