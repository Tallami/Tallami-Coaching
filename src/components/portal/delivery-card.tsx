import type { ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { formatPortalMoment, linkDomain } from "@/portal/format";
import type { StudentDelivery } from "@/portal/purchases";
import { youtubeWatchUrl } from "@/portal/youtube";
import { YoutubePlayer } from "./youtube-player";

/** Un link que abre en otra pestaña, sin darle a esa página el `window.opener` ni la dirección de esta. */
const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * El botón de una entrega: un link que abre en otra pestaña. Un texto largo (el dominio de un link) se corta
 * donde haga falta en vez de ensanchar la página.
 */
function NewTabButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button asChild variant="ink-outline" size="sm" className="h-auto max-w-full py-2">
      <a href={href} {...NEW_TAB}>
        {children}
      </a>
    </Button>
  );
}

/** Lo que abre cada tipo de entrega: el video en YouTube, el PDF desde la ruta del portal o el link con su dominio. */
async function DeliveryAction({ delivery }: { delivery: StudentDelivery }) {
  const t = await getTranslations("Portal.deliveries");
  const hint = <span className="sr-only"> {t("opensInNewTab")}</span>;

  if (delivery.kind === "youtube" && delivery.youtubeVideoId) {
    return (
      <NewTabButton href={youtubeWatchUrl(delivery.youtubeVideoId)}>
        {t("openYoutube")}
        {hint}
      </NewTabButton>
    );
  }
  if (delivery.kind === "pdf" && delivery.fileHref) {
    return (
      <NewTabButton href={delivery.fileHref}>
        {t("viewPdf")}
        {hint}
      </NewTabButton>
    );
  }
  if (delivery.kind === "link" && delivery.url) {
    const domain = linkDomain(delivery.url);
    return (
      <NewTabButton href={delivery.url}>
        {t("openLink")}
        {domain ? (
          <>
            {/* Un espacio de verdad entre la acción y el dominio: así se lee en el nombre del link ("Abrir drive.google.com"). */}{" "}
            <span translate="no" className="ml-2 min-w-0 font-medium opacity-80 [overflow-wrap:anywhere]">
              {domain}
            </span>
          </>
        ) : null}
        {hint}
      </NewTabButton>
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
