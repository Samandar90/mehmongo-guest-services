'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { GuestExperience } from '@/components/guest-experience';
import { readGuestContext } from '@/lib/guest-request';

export default function Home() {
  const searchParams = useSearchParams();
  const context = useMemo(() => readGuestContext(new URLSearchParams(searchParams.toString())), [searchParams]);
  return <GuestExperience context={context} />;
}
