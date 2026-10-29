import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { formatPortalMoment, linkDomain } from "@/portal/format";
import type { StudentDelivery } from "@/portal/purchases";
import { youtubeWatchUrl } from "@/portal/youtube";
import { YoutubePlayer } from "./youtube-player";

/** Un link que abre en otra pestaña, sin darle a esa página el `window.opener` ni la dirección de esta. */
const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

/** El botón de una entrega: cada tipo abre lo suyo. */
async function DeliveryAction({ delivery }: { delivery: StudentDelivery }) {
  const t = await getTranslations("Portal.deliveries");
  const hint = <span className="sr-only"> {t("opensInNewTab")}</span>;

  if (delivery.kind === "youtube" && delivery.youtubeVideoId) {
    return (
      <Button asChild variant="ink-outline" size="sm" className="h-auto max-w-full py-2">
        <a href={youtubeWatchUrl(delivery.youtubeVideoId)} {...NEW_TAB}>
          {t("openYoutube")}
          {hint}
        </a>
      </Button>
    );
  }
  if (delivery.kind === "pdf" && delivery.fileHref) {
    return (
      <Button asChild variant="ink-outline" size="sm" className="h-auto max-w-full py-2">
        <a href={delivery.fileHref} {...NEW_TAB}>
          {t("viewPdf")}
          {hint}
        </a>
      </Button>
    );
  }
  const domain = delivery.url ? linkDomain(delivery.url) : null;
  if (delivery.kind === "link" && delivery.url) {
    return (
      <Button asChild variant="ink-outline" size="sm" className="h-auto max-w-full py-2">
        <a href={delivery.url} {...NEW_TAB}>
          {t("openLink")}
          {domain ? (
            <span translate="no" className="ml-2 min-w-0 font-medium opacity-80 [overflow-wrap:anywhere]">
              {domain}
            </span>
          ) : null}
          {hint}
        </a>
      </Button>
    );
  }
  return null;
}

/** Una entrega de una compra: su tipo, su título, cuándo se subió y lo que hace falta para verla. */
export async function DeliveryCard({ delivery }: { delivery: StudentDelivery }) {
  const t = await getTranslations("Portal.deliveries");
  const locale = await getLocale();

  return (
    <li className="flex flex-col items-start gap-3 border-t border-rule pt-5 first:border-t-0 first:pt-0">
      <div className="min-w-0 max-w-full">
        <p className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[.85rem] text-ink-2">
          <span className="rounded-[2px] bg-neutral-tint px-2 py-0.5 text-[.75rem] font-bold uppercase tracking-wide text-ink">
            {t(`kinds.${delivery.kind}`)}
          </span>
          <span>{t("addedOn", { date: formatPortalMoment(delivery.createdAt, locale) })}</span>
        </p>
        <h5 className="text-[1.1rem] font-bold leading-snug [overflow-wrap:anywhere]">{delivery.title}</h5>
      </div>
      {delivery.kind === "youtube" && delivery.youtubeVideoId ? (
        <YoutubePlayer videoId={delivery.youtubeVideoId} title={delivery.title} />
      ) : null}
      <DeliveryAction delivery={delivery} />
    </li>
  );
}
