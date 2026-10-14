// Alumnos: alta y búsqueda. Las ventas apuntan a un alumno; al cargar una
// venta se elige uno que ya existe o se crea uno nuevo.

import { asc, ilike, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { containsPattern } from "@/db/like";
import { customers } from "@/db/schema";

/** Datos para dar de alta un alumno; lo que no se sabe queda vacío. */
export interface NewCustomerInput {
  name: string;
  discord?: string | null;
  /** ISO 3166-1 alfa-2: "AR", "BR", "MX" (se guarda en mayúsculas). */
  country?: string | null;
}

/** Lo que se muestra de un alumno al buscarlo para una venta. */
export interface CustomerOption {
  id: string;
  name: string;
  discord: string | null;
  country: string | null;
}

/** Alumnos que devuelve la búsqueda si no se pide otra cantidad. */
const DEFAULT_SEARCH_LIMIT = 8;
const COUNTRY_CODE = /^[A-Z]{2}$/;

/** El país de un alumno como se guarda: dos letras mayúsculas, o vacío. */
function normalizeCountry(country: string | null | undefined): string | null {
  const code = country?.trim().toUpperCase();
  if (!code) return null;
  if (!COUNTRY_CODE.test(code)) {
    throw new RangeError(`El país tiene que tener 2 letras (como AR), pero llegó "${country}".`);
  }
  return code;
}

/**
 * Alumnos cuyo nombre o Discord contienen el texto, sin distinguir mayúsculas
 * (también las acentuadas) pero sí los acentos: "matias" no encuentra a
 * "Matías". Orden por nombre. Un texto vacío trae los primeros alumnos.
 */
export async function searchCustomers(
  db: Db,
  q: string,
  limit: number = DEFAULT_SEARCH_LIMIT,
): Promise<CustomerOption[]> {
  const text = q.trim();
  const pattern = containsPattern(text);
  return db
    .select({
      id: customers.id,
      name: customers.name,
      discord: customers.discord,
      country: customers.country,
    })
    .from(customers)
    .where(text ? or(ilike(customers.name, pattern), ilike(customers.discord, pattern)) : undefined)
    .orderBy(asc(customers.name), asc(customers.createdAt), asc(customers.id))
    .limit(limit);
}

/** Da de alta un alumno y devuelve su id. */
export async function createCustomer(db: Db, input: NewCustomerInput): Promise<{ id: string }> {
  const [created] = await db
    .insert(customers)
    .values({
      name: input.name,
      discord: input.discord || null,
      country: normalizeCountry(input.country),
    })
    .returning({ id: customers.id });
  return created;
}
