import Link from 'next/link';
import { GuestNotice } from '@/components/guest-notice';

export default function Home() {
  return (
    <GuestNotice eyebrow="Guest services" title="Scan the code in your room">
      <p>
        MehmonGo turns the QR code in your hotel room into tours, transport, restaurant tables and tickets.
        There is no app to install and no account to create.
      </p>
      <p>
        Each code opens the services for one room, so this page has nothing to show on its own.
        If the code in your room does not work, reception can give you the current one.
      </p>
      <p>
        <Link href="/photo-credits">Photo credits</Link>
      </p>
    </GuestNotice>
  );
}
