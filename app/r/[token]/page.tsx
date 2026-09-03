import { GuestExperience } from '@/components/guest-experience';
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
  return context
    ? <GuestExperience context={context} />
    : <main>This room link is unavailable</main>;
}
