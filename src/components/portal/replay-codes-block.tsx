import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { REPLAY_CODES_MAX_LENGTH, REPLAY_DELIVERY_HOURS } from "@/payments/policy";
import { formatPortalDeadline } from "@/portal/format";
import type { StudentPurchase } from "@/portal/purchases";
import { ReplayCodesForm, type ReplayFormLabels } from "./replay-codes-form";

/** Los códigos de replay de una compra de VOD review: pedirlos, mostrar lo que mandó y hasta cuándo es la entrega. */
export async function ReplayCodesBlock({ purchase }: { purchase: Pick<StudentPurchase, "id" | "item" | "replay"> }) {
  const { replay } = purchase;
  if (replay.state === "none") return null;
  const t = await getTranslations("Portal.replay");
  const locale = (await getLocale()) as Locale;

  const labels: ReplayFormLabels = {
    label: t("label"),
    submit: replay.state === "sent" ? t("correct") : t("submit"),
    submitting: t("submitting"),
    saved: t("saved"),
    corrected: t("corrected"),
    invalid: t("errors.invalid", { max: REPLAY_CODES_MAX_LENGTH }),
    closed: t("errors.closed"),
    notFound: t("errors.notFound"),
    failed: t("errors.failed"),
  };
  const hours = REPLAY_DELIVERY_HOURS[purchase.item as keyof typeof REPLAY_DELIVERY_HOURS] ?? 0;

  return (
    <section data-testid="replay-codes" className="mt-7 border-t border-rule pt-5">
      <h4 className="mb-3 text-[.85rem] font-bold uppercase tracking-wide text-ink-2">{t("title")}</h4>
      {replay.state === "open" ? (
        <>
          <p className="mt-0 mb-4 text-ink-2">{t("openHint", { hours })}</p>
          <ReplayCodesForm saleId={purchase.id} maxLength={REPLAY_CODES_MAX_LENGTH} labels={labels} />
        </>
      ) : null}
      {replay.state === "sent" ? (
        <>
          <p className="mt-0 mb-3 font-bold">{t("sentOn", { date: formatPortalDeadline(replay.dueAt, locale) })}</p>
          {/* Texto del alumno: React lo escapa; los saltos de línea se respetan. */}
          <pre className="m-0 mb-4 max-w-full bg-neutral-tint p-3 font-mono text-[.9rem] break-words whitespace-pre-wrap">
            {replay.codes}
          </pre>
          {replay.editable ? (
            <>
              <p className="mt-0 mb-3 text-ink-2">{t("correctHint")}</p>
              <ReplayCodesForm
                saleId={purchase.id}
                initialCodes={replay.codes}
                maxLength={REPLAY_CODES_MAX_LENGTH}
                labels={labels}
              />
            </>
          ) : null}
        </>
      ) : null}
      {replay.state === "expired" ? <p className="m-0 text-ink-2">{t("expired")}</p> : null}
    </section>
  );
}
