// Las entregas de una venta como las muestra la tarjeta "Entregas" de la ficha
// (`deliveries-card.tsx`, un componente de cliente): solo texto, ya con la fecha
// escrita en hora de Argentina y el enlace para abrir cada una. Vive aparte del
// componente porque lo arma la página, en el servidor.

import { formatMoment } from "@/admin/dates";
import { saleDeliveryFileHref } from "@/admin/routes";
import type { Delivery, DeliveryKind } from "@/portal/deliveries";

export interface DeliveryRow {
  id: string;
  kind: DeliveryKind;
  title: string;
  /** Cuándo se cargó, en hora de Argentina ("28/10/2026, 10:30"). */
  createdAt: string;
  /** Dónde se abre: el PDF por la ruta del panel, el video en YouTube o el link tal cual. */
  href: string;
}

function hrefOf(saleId: string, delivery: Delivery): string {
  switch (delivery.kind) {
    case "pdf":
      return saleDeliveryFileHref(saleId, delivery.id);
    case "youtube":
      return `https://www.youtube.com/watch?v=${encodeURIComponent(delivery.youtubeVideoId ?? "")}`;
    case "link":
      return delivery.url ?? "";
  }
}

/** Las entregas de la venta `saleId` como filas de la tarjeta, en el mismo orden. */
export function toDeliveryRows(saleId: string, list: readonly Delivery[]): DeliveryRow[] {
  return list.map((delivery) => ({
    id: delivery.id,
    kind: delivery.kind,
    title: delivery.title,
    createdAt: formatMoment(delivery.createdAt),
    href: hrefOf(saleId, delivery),
  }));
}
