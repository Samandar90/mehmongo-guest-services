import Link from 'next/link';
import { CalendarClock, CircleAlert, ReceiptText, Send, type LucideIcon } from 'lucide-react';
import { attentionLabels } from '@/components/admin/request-table';
import type { OwnerAttention } from '@/lib/admin/insights';
import { requestsHref, type RequestAttention } from '@/lib/admin/requests';

const items: { key: keyof OwnerAttention; attention: RequestAttention; icon: LucideIcon; urgent: boolean }[] = [
  { key: 'overdueOpen', attention: 'overdue', icon: CircleAlert, urgent: true },
  { key: 'telegramFailed', attention: 'telegram', icon: Send, urgent: true },
  { key: 'dueToday', attention: 'today', icon: CalendarClock, urgent: false },
  { key: 'missingCost', attention: 'missing_cost', icon: ReceiptText, urgent: false },
];

/**
 * What needs a hand today, whatever period is on screen: a request left open
 * last month is no less open because the period moved on. Each line opens its
 * own rows, and a problem that is not there takes no space.
 */
export function AttentionPanel({ attention }: { attention: OwnerAttention }) {
  const present = items.filter((item) => attention[item.key] > 0);

  return (
    <section className="admin-card admin-attention" aria-labelledby="dashboard-attention-heading">
      <h2 id="dashboard-attention-heading">Требует внимания</h2>
      {present.length === 0 ? (
        <p className="admin-empty">Всё в порядке: просроченных заявок, ошибок Telegram и заявок без закупки нет.</p>
      ) : (
        <ul className="admin-attention-list">
          {present.map(({ key, attention: filter, icon: Icon, urgent }) => (
            <li key={key}>
              <Link
                href={requestsHref({ attention: filter })}
                className={urgent ? 'admin-attention-item admin-attention-urgent' : 'admin-attention-item'}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{attentionLabels[filter]}</span>
                <strong>{attention[key]}</strong>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
