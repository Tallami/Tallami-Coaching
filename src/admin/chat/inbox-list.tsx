import Link from "next/link";
import { formatMoment } from "@/admin/dates";
import { conversationHref } from "@/admin/routes";
import type { InboxRow } from "@/chat/conversations";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** "1 sin leer" / "3 sin leer": el texto es el mismo para quien ve el color y para quien no. */
function unreadLabel(count: number): string {
  return `${count} sin leer`;
}

function InboxItem({ row }: { row: InboxRow }) {
  const isUnread = row.unread > 0;
  return (
    <li
      data-testid="inbox-row"
      data-unread={isUnread}
      className={cn(
        "relative border-2 bg-white transition-colors duration-150 hover:bg-paper",
        isUnread ? "border-ink border-l-[10px] border-l-gold" : "border-rule border-l-[10px] border-l-rule",
      )}
    >
      <Link
        href={conversationHref(row.customerId)}
        prefetch={false}
        className="flex flex-col gap-1 px-4 py-3.5 focus-visible:outline-offset-[-4px] narrow:px-3"
      >
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <span className={cn("min-w-0 text-[1.125rem] [overflow-wrap:anywhere]", isUnread ? "font-extrabold" : "font-semibold")}>
            {row.customerName}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            {isUnread ? <Badge variant="warn">{unreadLabel(row.unread)}</Badge> : null}
            <time dateTime={row.lastMessageAt} className="text-[0.875rem] text-ink-2 tabular-nums">
              {formatMoment(new Date(row.lastMessageAt))}
            </time>
          </span>
        </span>
        <span className={cn("block [overflow-wrap:anywhere]", isUnread ? "font-semibold text-ink" : "text-ink-2")}>
          {row.lastSender === "coach" ? <span className="font-bold">Vos: </span> : null}
          {row.snippet}
        </span>
      </Link>
    </li>
  );
}

/**
 * La bandeja: una fila por conversación, las que tienen algo sin leer primero (ya vienen en ese orden de
 * `listInbox`). La fila sin leer lleva borde grueso dorado, el nombre en negrita y la cantidad escrita.
 * El comienzo del mensaje es siempre texto de React, en una sola línea que se corta con `overflow-wrap`.
 */
export function InboxList({ rows }: { rows: readonly InboxRow[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
      {rows.map((row) => (
        <InboxItem key={row.customerId} row={row} />
      ))}
    </ul>
  );
}
