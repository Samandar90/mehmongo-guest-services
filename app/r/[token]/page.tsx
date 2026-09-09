import { GuestExperience } from '@/components/guest-experience';
import { GuestNotice } from '@/components/guest-notice';
import { messages } from '@/lib/i18n/messages';
import { pageLocale } from '@/lib/i18n/server';
import { fetchRoomContext, RoomUnavailableError } from '@/lib/requests/api';
import type { RoomContextResult } from '@/supabase/functions/_shared/contracts';

type SearchParams = Record<string, string | string[] | undefined>;

async function resolveRoomContext(token: string): Promise<RoomContextResult | null> {
  try {
    return await fetchRoomContext(token);
  } catch (error) {
    if (error instanceof RoomUnavailableError) return null;
    throw error;
  }
}

export default async function RoomPage({ params, searchParams }: {
  params: { token: string };
  searchParams?: SearchParams | Promise<SearchParams>;
}) {
  const [context, locale] = await Promise.all([resolveRoomContext(params.token), pageLocale(searchParams)]);
  if (context) return <GuestExperience context={context} locale={locale} />;

  const t = messages[locale].notice.unavailable;
  return (
    <GuestNotice locale={locale} eyebrow={t.eyebrow} title={t.title}>
      <p>{t.first}</p>
      <p>{t.second}</p>
    </GuestNotice>
  );
}
