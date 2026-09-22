'use client';

import { Plus } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/context';

/**
 * Optional fields behind one button, so the required path runs straight to
 * the submit button. It starts open when something in it is already filled
 * in — a note kept from another service must not travel with a request out
 * of sight — and once open it stays open for the same reason.
 */
export function AddDetails({ filled, children }: { filled: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(filled);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusOnOpenRef = useRef(false);

  // The button the guest pressed is gone, so the focus moves to the first
  // field it revealed rather than falling back to the page.
  useEffect(() => {
    if (!open || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    bodyRef.current?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, [open]);

  if (!open) {
    return (
      <button
        className="add-details-button"
        type="button"
        onClick={() => {
          focusOnOpenRef.current = true;
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" />
        {t.common.addDetails}
      </button>
    );
  }

  return <div className="add-details" ref={bodyRef}>{children}</div>;
}
