import type { Metadata, Viewport } from 'next';
import { AdminShell } from '@/components/admin/admin-shell';
import { installBootstrapScript } from '@/lib/admin/install-script';

/**
 * The manifest is attached here and not in the root layout on purpose: it
 * scopes the installable app to /admin. A guest who scans a plaque must never
 * be offered "install MehmonGo admin".
 */
export const metadata: Metadata = {
  title: 'MehmonGo — админка',
  manifest: '/admin.webmanifest',
  appleWebApp: { capable: true, title: 'MehmonGo', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#102B4E',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Runs while the HTML parses: the browser offers the install prompt
          once, early, and the button in the navigation mounts too late to
          hear it. See lib/admin/install-script.ts. */}
      <script dangerouslySetInnerHTML={{ __html: installBootstrapScript }} />
      <AdminShell>{children}</AdminShell>
    </>
  );
}
