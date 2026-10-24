import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';

/** Temporary page for sections still being rebuilt: points to the previous screen. */
export default function LegacyNotice({ title, legacyHash, children }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="card empty-state">
        <strong>새 화면을 준비하고 있습니다</strong>
        <div>{children || '이 메뉴는 다음 단계에서 새로 만들어집니다. 그동안은 이전 화면을 사용하세요.'}</div>
        <Link className="btn secondary" href={'/legacy#/' + legacyHash}>이전 화면에서 열기</Link>
      </div>
    </>
  );
}
