import { getTranslations } from "next-intl/server";

type MessageKey = "unavailable" | "loadFailed";

/**
 * Un mensaje a página completa que no depende de quién mira: el portal todavía no está configurado
 * (`unavailable`) o la base no respondió (`loadFailed`). Sin datos de nadie.
 */
export async function MessageView({ messageKey }: { messageKey: MessageKey }) {
  const t = await getTranslations(`Portal.${messageKey}`);

  return (
    <section aria-labelledby="message-title" className="max-w-2xl border-t-4 border-gold bg-white/60 p-[clamp(20px,4vw,32px)]">
      <h2 id="message-title" className="text-[clamp(1.6rem,4vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
        {t("title")}
      </h2>
      <p className="mt-4 max-w-[52ch] text-ink-2">{t("body")}</p>
    </section>
  );
}
