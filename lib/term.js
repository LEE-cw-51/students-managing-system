/** Current school year/semester for a date: Mar–Aug → 1학기, Sep–Feb → 2학기 (Jan–Feb count as last year's). */
export function currentTerm(today) {
  const [y, m] = String(today || '').split('-').map(Number);
  if (!y) return { year: String(new Date().getFullYear()), semester: '1' };
  if (m >= 3 && m <= 8) return { year: String(y), semester: '1' };
  return { year: String(m <= 2 ? y - 1 : y), semester: '2' };
}
