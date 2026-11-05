import { getTranslations } from "next-intl/server";
import type { PortalNotice as Notice } from "@/portal/page-state";

const TONE_CLASSES: Record<Notice["tone"], string> = {
  error: "border-danger bg-danger-tint text-danger-ink",
  success: "border-ok-ink bg-ok-tint text-ok-ink",
  info: "border-info-ink bg-info-tint text-info-ink",
};

interface PortalNoticeProps {
  notice: Notice;
  /** Si el pago falló o sigue sin confirmarse: la pantalla para intentarlo de nuevo. */
  retryHref?: string;
}

/**
 * Un aviso arriba de la página: un error se anuncia con urgencia (`alert`), lo demás sin
 * interrumpir (`status`). El texto sale del catálogo, nunca de la dirección.
 */
export async function PortalNotice({ notice, retryHref }: PortalNoticeProps) {
  const t = await getTranslations("Portal");

  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={`mb-8 border-l-4 px-4 py-3 font-semibold ${TONE_CLASSES[notice.tone]}`}
    >
      {t(`notices.${notice.key}`)}
      {retryHref ? (
        <>
          {" "}
          <a href={retryHref} className="underline underline-offset-4">
            {/* Quien lee que se está esperando el pago puede ser alguien que se fue sin pagar. */}
            {notice.key === "paymentPending" ? t("retryUnpaid") : t("retryPayment")}
          </a>
        </>
      ) : null}
    </p>
  );
}
