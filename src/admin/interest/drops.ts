// La cuenta de los clics que el registro descarta en silencio por pasarse del
// tope de todo el sitio (por minuto o por hora, ver `record.ts`). Sin ella un
// descarte no deja rastro y no se sabe si el tope está tapando tráfico de
// verdad: la página Servicios muestra cuántos fueron en el período.
//
// Es un solo número por día de Argentina (`interest_drops`), sin ningún dato del
// pedido. Contarlo es un `insert … on conflict do update` de una fila: no crece
// la tabla con el abuso.

import { sql } from "drizzle-orm";
import { todayInArgentina } from "@/admin/dates";
import type { Db } from "@/db/client";
import { interestDrops } from "@/db/schema";

/**
 * Suma un clic descartado al día de Argentina de `at`. Un fallo se registra
 * (solo el tipo de error, el mensaje puede traer la dirección de la base) y no
 * se propaga: el clic ya se descartó, y contarlo no puede convertirse en un
 * error para el sitio público.
 */
export async function countDroppedClick(db: Db, at: Date): Promise<void> {
  try {
    await db
      .insert(interestDrops)
      .values({ day: todayInArgentina(at), dropped: 1 })
      .onConflictDoUpdate({
        target: interestDrops.day,
        set: { dropped: sql`${interestDrops.dropped} + 1` },
      });
  } catch (error) {
    console.error("[interest] no se pudo contar un clic descartado:", error instanceof Error ? error.name : "error");
  }
}
