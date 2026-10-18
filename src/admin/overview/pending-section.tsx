import { ArrowRightIcon, CircleCheckIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ITEM_LABELS } from "@/admin/catalog";
import type { PendingDelivery, PendingSaleRef, SessionToMark, UpcomingSession } from "@/admin/metrics/pending";
import { formatDueDay, formatSessionWhen } from "@/admin/overview/labels";
import type { OverviewData } from "@/admin/overview/overview-data";
import { SectionCard } from "@/admin/overview/section-card";
import { ADMIN_ROUTES, saleHref } from "@/admin/routes";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";

/** Cuántas sesiones por marcar se ven de entrada; el resto, al desplegar. */
const TO_MARK_VISIBLE = 5;

interface PendingRowProps {
  sale: PendingSaleRef;
  /** Lo que sigue al servicio en la segunda línea: la fecha. */
  when: string;
  badge?: ReactNode;
}

/** Una fila: el alumno (enlace a su venta), el servicio con la fecha y, si hace falta, una insignia. */
function PendingRow({ sale, when, badge }: PendingRowProps) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-rule py-2.5 last:border-b-0">
      <div className="min-w-0">
        <Link
          href={saleHref(sale.id)}
          prefetch={false}
          className="rounded-[2px] font-bold underline decoration-ink-2/50 underline-offset-4 hover:decoration-ink"
        >
          {sale.customerName}
        </Link>
        <p className="text-[0.875rem] leading-snug text-ink-2">
          {ITEM_LABELS[sale.item]} · {when}
        </p>
      </div>
      {badge ? <div className="shrink-0 pt-0.5">{badge}</div> : null}
    </li>
  );
}

interface BlockProps {
  testId: string;
  title: string;
  count?: number;
  hint?: string;
  children: ReactNode;
}

/** Un grupo de pendientes: título con su cantidad, una ayuda corta y las filas. */
function Block({ testId, title, count, hint, children }: BlockProps) {
  return (
    <div data-testid={testId} className="min-w-0 border-t-2 border-ink pt-3">
      <h3 className="flex items-center justify-between gap-3 text-[1.125rem] leading-tight font-extrabold [font-stretch:75%]">
        {title}
        {count !== undefined ? (
          <span className="min-w-7 rounded-[4px] bg-ink px-2 py-0.5 text-center text-[0.9375rem] text-paper tabular-nums">
            {count}
          </span>
        ) : null}
      </h3>
      {hint ? <p className="mt-1 text-[0.875rem] leading-snug text-ink-2">{hint}</p> : null}
      <div className="mt-1">{children}</div>
    </div>
  );
}

function NothingPending({ children = "Nada pendiente." }: { children?: ReactNode }) {
  return (
    <p className="mt-2 flex items-center gap-2 text-ink-2">
      <CircleCheckIcon className="size-5 shrink-0 text-ok-ink" aria-hidden="true" />
      {children}
    </p>
  );
}

const UNPAID_BADGE = <Badge variant="warn">Sin cobrar</Badge>;

function deliveryWhen(delivery: PendingDelivery, today: string): string {
  if (delivery.dueAt === null) return "sin fecha de entrega";
  const day = formatDueDay(delivery.dueAt, today);
  return delivery.overdue ? `venció el ${day}` : `vence el ${day}`;
}

function Deliveries({ deliveries, today }: { deliveries: readonly PendingDelivery[]; today: string }) {
  return (
    <Block
      testId="pending-deliveries"
      title="Entregas por hacer"
      count={deliveries.length}
      hint="VOD grabados y planes de juego cobrados que todavía no entregaste."
    >
      {deliveries.length === 0 ? (
        <NothingPending />
      ) : (
        <ul className="m-0 list-none p-0">
          {deliveries.map((delivery) => (
            <PendingRow
              key={delivery.id}
              sale={delivery}
              when={deliveryWhen(delivery, today)}
              badge={delivery.overdue ? <Badge variant="danger">Vencida</Badge> : null}
            />
          ))}
        </ul>
      )}
    </Block>
  );
}

function Sessions({ sessions }: { sessions: readonly UpcomingSession[] }) {
  return (
    <Block
      testId="pending-sessions"
      title="Sesiones de los próximos 7 días"
      count={sessions.length}
      hint="Desde hoy. Las que figuran sin cobrar conviene cobrarlas antes de darlas."
    >
      {sessions.length === 0 ? (
        <NothingPending />
      ) : (
        <ul className="m-0 list-none p-0">
          {sessions.map((session) => (
            <PendingRow
              key={session.id}
              sale={session}
              when={formatSessionWhen(session.dueAt)}
              badge={session.unpaid ? UNPAID_BADGE : null}
            />
          ))}
        </ul>
      )}
    </Block>
  );
}

function ToMarkRow({ session }: { session: SessionToMark }) {
  return (
    <PendingRow
      sale={session}
      when={`fue el ${formatSessionWhen(session.dueAt)}`}
      badge={session.unpaid ? UNPAID_BADGE : null}
    />
  );
}

function ToMark({ sessions }: { sessions: readonly SessionToMark[] }) {
  const visible = sessions.slice(0, TO_MARK_VISIBLE);
  const rest = sessions.slice(TO_MARK_VISIBLE);
  return (
    <Block
      testId="pending-to-mark"
      title="Sesiones por marcar"
      count={sessions.length}
      hint="Ya pasaron y siguen sin marcarse como hechas. Marcalas, o cobralas o cancelalas si no se dieron."
    >
      {sessions.length === 0 ? (
        <NothingPending />
      ) : (
        <>
          <ul className="m-0 list-none p-0">
            {visible.map((session) => (
              <ToMarkRow key={session.id} session={session} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="group/rest">
              <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-[4px] font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                <ArrowRightIcon
                  className="size-4 transition-transform duration-150 group-open/rest:rotate-90"
                  aria-hidden="true"
                />
                {rest.length === 1 ? "Ver 1 más" : `Ver las ${rest.length} restantes`}
              </summary>
              <ul className="m-0 list-none p-0">
                {rest.map((session) => (
                  <ToMarkRow key={session.id} session={session} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </Block>
  );
}

function Uninvoiced({ uninvoiced }: { uninvoiced: OverviewData["pending"]["uninvoiced"] }) {
  return (
    <Block
      testId="pending-uninvoiced"
      title="Cobradas sin facturar"
      hint="Ventas cobradas o entregadas cuya factura todavía no marcaste."
    >
      {uninvoiced.count === 0 ? (
        <NothingPending>Todo lo cobrado está facturado.</NothingPending>
      ) : (
        <>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="text-[2rem] leading-none font-extrabold [font-stretch:75%]">{uninvoiced.count}</span>
            <span className="text-ink-2">{uninvoiced.count === 1 ? "venta" : "ventas"}</span>
          </p>
          <p className="mt-1">
            Suman <strong className="tabular-nums">{formatMoney(uninvoiced.arsMinor, "ARS")}</strong>
            <span className="text-ink-2"> ({formatMoney(uninvoiced.usdMinor, "USD")})</span>
          </p>
          <Link
            href={ADMIN_ROUTES.billing}
            prefetch={false}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-[4px] font-bold underline decoration-ink-2/50 underline-offset-4 hover:decoration-ink"
          >
            Ir a facturación
            <ArrowRightIcon className="size-4" aria-hidden="true" />
          </Link>
        </>
      )}
    </Block>
  );
}

/** Lo que no hay que olvidarse: entregas, sesiones, sesiones sin marcar y ventas sin facturar. No depende del período. */
export function PendingSection({ data }: { data: OverviewData }) {
  const { deliveries, sessions, toMark, uninvoiced } = data.pending;
  return (
    <SectionCard
      id="pendientes"
      testId="pending"
      title="Pendientes"
      description="Lo que no te puede quedar sin hacer. No depende del período que elijas."
      accent="gold"
    >
      {/* Dos columnas que se apilan sin alinear filas: lo atrasado a la izquierda, lo que viene a la derecha. */}
      <div className="grid grid-cols-2 items-start gap-x-8 gap-y-7 narrow:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-7">
          <Deliveries deliveries={deliveries} today={data.today} />
          <ToMark sessions={toMark} />
        </div>
        <div className="flex min-w-0 flex-col gap-7">
          <Sessions sessions={sessions} />
          <Uninvoiced uninvoiced={uninvoiced} />
        </div>
      </div>
    </SectionCard>
  );
}
