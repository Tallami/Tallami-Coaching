import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations("NotFound");

  return (
    <main
      id="contenido"
      className="mx-auto flex max-w-wrap flex-col items-start gap-6 px-gutter py-24"
    >
      <h1 className="text-4xl font-extrabold">{t("title")}</h1>
      <p className="text-ink-2">{t("body")}</p>
      <Button asChild variant="ink-outline">
        <Link href="/">{t("back")}</Link>
      </Button>
    </main>
  );
}
