import Link from 'next/link';
import { GuestNotice } from '@/components/guest-notice';
import { messages } from '@/lib/i18n/messages';
import { pageLocale } from '@/lib/i18n/server';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({ searchParams }: { searchParams?: SearchParams | Promise<SearchParams> }) {
  const locale = await pageLocale(searchParams);
  const t = messages[locale];

  return (
    <GuestNotice locale={locale} eyebrow={t.notice.root.eyebrow} title={t.notice.root.title}>
      <p>{t.notice.root.first}</p>
      <p>{t.notice.root.second}</p>
      <p>
        <Link href="/photo-credits">{t.common.photoCredits}</Link>
      </p>
    </GuestNotice>
  );
}
