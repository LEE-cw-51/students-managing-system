/** Marker for students left out of exam-class placement. */
export const OUT = '__out__';

/** Exam class names are compared by this key (the browser twin of LMS.examClassNameKey). */
export function classNameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
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
