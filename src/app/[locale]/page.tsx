import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await getTranslations("Metadata");

  return (
    <main id="contenido" className="mx-auto max-w-wrap px-gutter py-16">
      <h1 className="text-4xl font-extrabold">{t("title")}</h1>
    </main>
  );
}
