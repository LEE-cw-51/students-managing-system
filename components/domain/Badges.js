/** Warning badges from LMS.studentBadges: [{ code, label, tone }]. `quiet` hides low-priority ones. */
export default function Badges({ badges, quiet }) {
  const list = (badges || []).filter((b) => !quiet || b.tone !== 'muted');
  if (!list.length) return null;
  return (
    <span className="cluster" style={{ gap: 4 }}>
      {list.map((b) => (
        <span key={b.code} className={'tag ' + (b.tone === 'danger' ? 'danger' : b.tone === 'warn' ? 'warn' : 'muted')}>
          {b.tone === 'muted' ? '' : '⚠ '}{b.label}
        </span>
      ))}
    </span>
  );
}
