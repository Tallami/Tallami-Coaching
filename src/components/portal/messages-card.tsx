import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";

interface MessagesCardProps {
  /** Cuántos mensajes de Tallami todavía no leyó el alumno. */
  unread: number;
  locale: Locale;
}

/**
 * La puerta a los mensajes con Tallami, arriba de las compras: cuántos hay sin leer y el enlace. Con algo
 * sin leer, la cuenta va en dorado sobre el escenario para que se vea de un vistazo.
 */
export async function MessagesCard({ unread, locale }: MessagesCardProps) {
  const t = await getTranslations("Chat.card");

  return (
    <section
      aria-labelledby="messages-card-title"
      className="stage mb-12 flex flex-wrap items-center justify-between gap-x-8 gap-y-5 rounded-[4px] border-l-4 border-gold p-[clamp(20px,3.5vw,32px)]"
    >
      <div className="min-w-0 max-w-[48ch]">
        <h2 id="messages-card-title" className="m-0 text-[clamp(1.5rem,3.5vw,2rem)] font-extrabold font-stretch-80% leading-tight">
          {t("title")}
        </h2>
        <p className="mt-2 text-on-stage-2">{t("body")}</p>
        <p className={`mt-3 text-[.95rem] font-bold ${unread > 0 ? "text-gold" : "text-on-stage"}`}>
          {t("unread", { count: unread })}
        </p>
      </div>
      <Button asChild size="sm">
        <a href={`/${locale}/portal/mensajes`}>{t("open")}</a>
      </Button>
    </section>
  );
}
