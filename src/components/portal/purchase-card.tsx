import { getLocale, getTranslations } from "next-intl/server";
import type { SaleStatus } from "@/admin/catalog";
import { formatPortalDay, formatPortalMoney } from "@/portal/format";
import type { StudentPurchase } from "@/portal/purchases";
import { DeliveryCard } from "./delivery-card";

/** El color de la insignia de cada estado (cada par contrasta 7:1 o más; ver `globals.css`). */
const STATUS_CLASSES: Record<SaleStatus, string> = {
  pending: "bg-warn-tint text-warn-ink",
  paid: "bg-info-tint text-info-ink",
  delivered: "bg-ok-tint text-ok-ink",
  cancelled: "bg-neutral-tint text-ink",
  refunded: "bg-danger-tint text-danger-ink",
};

/** Una compra que no sigue en pie: el monto se tacha para que no se lea como un cobro. */
const VOID_STATUSES: ReadonlySet<SaleStatus> = new Set(["cancelled", "refunded"]);

/**
 * Una compra, con el estilo de la carta de servicios de la portada: el servicio, una línea
 * punteada y lo que vale; abajo su estado, la fecha de cobro y las entregas de Tallami.
 */
export async function PurchaseCard({ purchase }: { purchase: StudentPurchase }) {
  const t = await getTranslations("Portal");
  const locale = await getLocale();
  const titleId = `purchase-${purchase.id}`;
  // Una compra pendiente todavía no se cobró, tenga o no un día cargado; una cancelada sin cobro no lleva fecha.
  const dateText =
    purchase.status === "pending"
      ? t("purchases.unpaid")
      : purchase.paidOn
        ? t("purchases.paidOn", { date: formatPortalDay(purchase.paidOn, locale) })
        : null;

  return (
    <article aria-labelledby={titleId} className="border-t-4 border-ink bg-white/60 p-[clamp(18px,3.5vw,32px)]">
      <div className="flex items-baseline gap-3">
        <h3 id={titleId} className="m-0 min-w-0 text-[1.3rem] font-bold font-stretch-90% leading-snug">
          {t(`items.${purchase.item}`)}
        </h3>
        <span aria-hidden="true" className="min-w-6 flex-1 -translate-y-1.5 border-b-2 border-dotted border-[#9aa39a]" />
        <span
          className={`whitespace-nowrap text-[1.5rem] font-extrabold font-stretch-80% leading-none tabular-nums ${
            VOID_STATUSES.has(purchase.status) ? "line-through decoration-2" : ""
          }`}
        >
          {formatPortalMoney(purchase.amountMinor, purchase.currency, locale)}
        </span>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[.95rem] text-ink-2">
        <span
          className={`rounded-[2px] px-2.5 py-1 text-[.8rem] font-bold uppercase tracking-wide ${STATUS_CLASSES[purchase.status]}`}
        >
          {t(`status.${purchase.status}`)}
        </span>
        {dateText ? <span>{dateText}</span> : null}
      </p>
      <h4 className="mt-7 mb-4 text-[.85rem] font-bold uppercase tracking-wide text-ink-2">{t("deliveries.title")}</h4>
      {purchase.deliveries.length === 0 ? (
        <p className="m-0 text-ink-2">{t("deliveries.empty")}</p>
      ) : (
        <ul role="list" className="m-0 flex list-none flex-col gap-5 p-0">
          {purchase.deliveries.map((delivery) => (
            <DeliveryCard key={delivery.id} delivery={delivery} />
          ))}
        </ul>
      )}
    </article>
  );
}
