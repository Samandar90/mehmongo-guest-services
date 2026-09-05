import { GuestExperience } from '@/components/guest-experience';
import { GuestNotice } from '@/components/guest-notice';
import { fetchRoomContext, RoomUnavailableError } from '@/lib/requests/api';
import type { RoomContextResult } from '@/supabase/functions/_shared/contracts';

async function resolveRoomContext(token: string): Promise<RoomContextResult | null> {
  try {
    return await fetchRoomContext(token);
  } catch (error) {
    if (error instanceof RoomUnavailableError) return null;
    throw error;
  }
}

export default async function RoomPage({ params }: { params: { token: string } }) {
  const context = await resolveRoomContext(params.token);
  if (context) return <GuestExperience context={context} />;

  return (
    <GuestNotice eyebrow="Room link" title="This room link is unavailable">
      <p>
        The code you scanned is no longer active for this room.
      </p>
      <p>
        Please ask reception for the current code. Nothing you entered was sent, and no request was created.
      </p>
    </GuestNotice>
  );
}
