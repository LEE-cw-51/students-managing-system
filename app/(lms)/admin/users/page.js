import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '../../../../lib/auth.js';
import PageHeader from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/Feedback';
import UsersAdmin from '@/components/domain/admin/UsersAdmin';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=%2Fadmin%2Fusers');
  if (session.role !== 'admin') {
    return (
      <div className="admin-page">
        <PageHeader title="계정 관리" />
        <div className="card">
          <EmptyState title="관리자만 볼 수 있는 화면입니다"
            action={<Link className="btn secondary" href="/today">오늘 화면으로</Link>}>
            강사 초대나 비밀번호 재설정이 필요하면 관리자에게 요청해 주세요.
          </EmptyState>
        </div>
      </div>
    );
  }
  return <UsersAdmin />;
}
