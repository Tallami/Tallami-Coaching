import { getTranslations } from "next-intl/server";
import type { StudentPurchase } from "@/portal/purchases";
import { PurchaseCard } from "./purchase-card";

/** Las compras del alumno, las más nuevas primero; o un estado vacío claro si todavía no tiene. */
export async function PurchaseList({ purchases }: { purchases: readonly StudentPurchase[] }) {
  const t = await getTranslations("Portal.purchases");

  return (
    <section aria-labelledby="purchases-title">
      <h2 id="purchases-title" className="text-[clamp(1.9rem,4.5vw,2.75rem)] font-extrabold font-stretch-72% leading-none">
        {t("title")}
      </h2>
      {purchases.length === 0 ? (
        <p className="mt-6 max-w-[52ch] text-ink-2">{t("empty")}</p>
      ) : (
        <ul role="list" className="m-0 mt-7 flex list-none flex-col gap-8 p-0">
          {purchases.map((purchase) => (
            <li key={purchase.id}>
              <PurchaseCard purchase={purchase} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
