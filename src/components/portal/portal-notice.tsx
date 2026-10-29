import { getTranslations } from "next-intl/server";
import type { PortalNotice as Notice } from "@/portal/page-state";

const TONE_CLASSES: Record<Notice["tone"], string> = {
  error: "border-danger bg-danger-tint text-danger-ink",
  success: "border-ok-ink bg-ok-tint text-ok-ink",
  info: "border-info-ink bg-info-tint text-info-ink",
};

/**
 * Un aviso arriba de la página: un error se anuncia con urgencia (`alert`), lo demás sin
 * interrumpir (`status`). El texto sale del catálogo, nunca de la dirección.
 */
export async function PortalNotice({ notice }: { notice: Notice }) {
  const t = await getTranslations("Portal.notices");

  return (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={`mb-8 border-l-4 px-4 py-3 font-semibold ${TONE_CLASSES[notice.tone]}`}
    >
      {t(notice.key)}
    </p>
  );
}
