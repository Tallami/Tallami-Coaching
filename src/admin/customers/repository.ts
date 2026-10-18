// Alumnos: alta, edición, búsqueda y lista con lo que compró cada uno. Las
// ventas apuntan a un alumno; al cargar una venta se elige uno que ya existe o
// se crea uno nuevo.
//
// Lo que compró un alumno cuenta solo las ventas de ingreso (cobradas o
// entregadas, `INCOME_STATUSES`) con día de cobro de hoy o anterior, en Argentina:
// una cancelada, una reembolsada, una pendiente o una con fecha de cobro futura
// no suman en compras, total gastado, fechas ni servicios, igual que en el resto
// del panel. Su ficha, en cambio, muestra todas sus ventas con su estado.

import { and, asc, count, eq, ilike, inArray, lte, max, min, or, sql, type SQL } from "drizzle-orm";
import { INCOME_STATUSES, SALE_ITEMS, type SaleItem } from "@/admin/catalog";
import { todayInArgentina } from "@/admin/dates";
import { newestSalesFirst, saleRowColumns, toSaleRow, type SaleRow } from "@/admin/sales/sale-row";
import type { Db } from "@/db/client";
import { containsPattern } from "@/db/like";
import { customers, sales } from "@/db/schema";
import { isUuid } from "@/db/uuid";

/** Los datos de un alumno; lo que no se sabe queda vacío. */
export interface CustomerInput {
  name: string;
  discord?: string | null;
  /** ISO 3166-1 alfa-2: "AR", "BR", "MX" (se guarda en mayúsculas). */
  country?: string | null;
  notes?: string | null;
}

/** Lo que se muestra de un alumno al buscarlo para una venta. */
export interface CustomerOption {
  id: string;
  name: string;
  discord: string | null;
  country: string | null;
}

/** Un alumno con lo que compró (solo ventas de ingreso, cobradas hasta hoy). */
export interface CustomerStats extends CustomerOption {
  /** Cantidad de ventas cobradas o entregadas, con día de cobro de hoy o anterior. */
  purchases: number;
  /** Suma de esas ventas en dólares, en centavos. */
  totalUsdMinor: number;
  /** Día de cobro de la primera y de la última compra, "AAAA-MM-DD"; `null` si no compró. */
  firstPaidOn: string | null;
  lastPaidOn: string | null;
  /** Servicios que compró, sin repetir, en el orden del catálogo. */
  items: SaleItem[];
}

/** La ficha de un alumno: sus datos, lo que compró y todas sus ventas. */
export interface CustomerDetail extends CustomerStats {
  notes: string | null;
  /** Todas sus ventas, con su estado: las que todavía no se cobraron primero y después de la más nueva a la más vieja. */
  sales: SaleRow[];
}

/** El alumno que se busca no existe (por ejemplo, ya no está). */
export class CustomerNotFoundError extends Error {
  constructor() {
    super("Ese alumno ya no existe: elegí otro o cargalo de nuevo.");
    this.name = "CustomerNotFoundError";
  }
}

/** Alumnos que devuelve la búsqueda si no se pide otra cantidad. */
const DEFAULT_SEARCH_LIMIT = 8;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const ITEM_SEPARATOR = ",";

/** El país de un alumno como se guarda: dos letras mayúsculas, o vacío. */
function normalizeCountry(country: string | null | undefined): string | null {
  const code = country?.trim().toUpperCase();
  if (!code) return null;
  if (!COUNTRY_CODE.test(code)) {
    throw new RangeError(`El país tiene que tener 2 letras (como AR), pero llegó "${country}".`);
  }
  return code;
}

/** Condición "el nombre o el Discord contienen el texto", o `undefined` si no hay texto que buscar. */
function matchesText(text: string): SQL | undefined {
  const pattern = containsPattern(text);
  return pattern ? or(ilike(customers.name, pattern), ilike(customers.discord, pattern)) : undefined;
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
  // Sin texto que buscar (vacío, espacios o NUL) se traen los primeros alumnos.
  return db
    .select({
      id: customers.id,
      name: customers.name,
      discord: customers.discord,
      country: customers.country,
    })
    .from(customers)
    .where(matchesText(q))
    .orderBy(asc(customers.name), asc(customers.createdAt), asc(customers.id))
    .limit(limit);
}

/** Da de alta un alumno y devuelve su id. */
export async function createCustomer(db: Db, input: CustomerInput): Promise<{ id: string }> {
  const [created] = await db
    .insert(customers)
    .values({
      name: input.name,
      discord: input.discord || null,
      country: normalizeCountry(input.country),
      notes: input.notes || null,
    })
    .returning({ id: customers.id });
  return created;
}

/**
 * Reemplaza los datos del alumno por estos: lo que no se manda (Discord, país,
 * notas) queda vacío. No toca sus ventas. Tira `CustomerNotFoundError` si no
 * existe (o si el id no es un id).
 */
export async function updateCustomer(
  db: Db,
  id: string,
  input: CustomerInput,
): Promise<{ id: string }> {
  if (!isUuid(id)) throw new CustomerNotFoundError();
  const [updated] = await db
    .update(customers)
    .set({
      name: input.name,
      discord: input.discord || null,
      country: normalizeCountry(input.country),
      notes: input.notes || null,
    })
    .where(eq(customers.id, id))
    .returning({ id: customers.id });
  if (!updated) throw new CustomerNotFoundError();
  return updated;
}

/** La lista de servicios que devuelve `string_agg`, en el orden del catálogo. */
function itemsFromAggregate(aggregate: string | null): SaleItem[] {
  const present = new Set((aggregate ?? "").split(ITEM_SEPARATOR));
  return SALE_ITEMS.filter((item) => present.has(item));
}

/**
 * Los alumnos que cumplen `where`, cada uno con lo que compró. Es un solo
 * `group by` en la base: las ventas de ingreso se unen al alumno con un
 * `left join` (así los que no compraron siguen en la lista, con ceros) y se
 * resumen ahí mismo; solo se unen las de día de cobro de hoy (en Argentina, según
 * `now`) o anterior: una venta con fecha futura todavía no se cobró. La suma de un `bigint` llega como texto numérico y se
 * pasa a `number` (los montos de este negocio entran de sobra en 2^53).
 * Orden por la última compra, la más nueva primero; los que no compraron al
 * final, y a igual día, por nombre.
 */
async function selectWithStats(db: Db, where: SQL | undefined, now: Date): Promise<CustomerStats[]> {
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      discord: customers.discord,
      country: customers.country,
      purchases: count(sales.id),
      totalUsdMinor: sql<number>`coalesce(sum(${sales.amountUsdMinor}), 0)`.mapWith(Number),
      firstPaidOn: min(sales.paidOn),
      lastPaidOn: max(sales.paidOn),
      // Los servicios son palabras del catálogo, sin comas: se separan en TypeScript
      // (un arreglo de la base no llega igual desde todos los drivers). El separador
      // es una constante del código, no un dato: va escrito en la consulta.
      items: sql<string | null>`string_agg(distinct ${sales.item}, ${sql.raw(`'${ITEM_SEPARATOR}'`)})`,
    })
    .from(customers)
    .leftJoin(
      sales,
      and(
        eq(sales.customerId, customers.id),
        inArray(sales.status, [...INCOME_STATUSES]),
        lte(sales.paidOn, todayInArgentina(now)),
      ),
    )
    .where(where)
    .groupBy(customers.id)
    .orderBy(
      sql`max(${sales.paidOn}) desc nulls last`,
      asc(customers.name),
      asc(customers.createdAt),
      asc(customers.id),
    );
  return rows.map(({ items, ...rest }) => ({ ...rest, items: itemsFromAggregate(items) }));
}

/**
 * Los alumnos con lo que compró cada uno (solo ventas de ingreso con día de
 * cobro hasta hoy), el que compró hace menos primero. Con texto, solo los que lo
 * tienen en el nombre o en el Discord (igual que `searchCustomers`, pero sin tope
 * de cantidad). `now` fija el "hoy" de Argentina: lo usan los tests.
 */
export async function listCustomersWithStats(
  db: Db,
  q?: string,
  now: Date = new Date(),
): Promise<CustomerStats[]> {
  return selectWithStats(db, q === undefined ? undefined : matchesText(q), now);
}

/**
 * La ficha de un alumno, o `null` si no existe (o el id no es un id): sus
 * datos, lo que compró (con la misma regla que la lista: solo lo cobrado hasta
 * hoy) y todas sus ventas, también las canceladas, reembolsadas, pendientes y
 * las de fecha de cobro futura, con su estado.
 */
export async function getCustomer(
  db: Db,
  id: string,
  now: Date = new Date(),
): Promise<CustomerDetail | null> {
  if (!isUuid(id)) return null;
  const [[stats], [profile], history] = await Promise.all([
    selectWithStats(db, eq(customers.id, id), now),
    db.select({ notes: customers.notes }).from(customers).where(eq(customers.id, id)).limit(1),
    db
      .select(saleRowColumns)
      .from(sales)
      .innerJoin(customers, eq(sales.customerId, customers.id))
      .where(eq(sales.customerId, id))
      .orderBy(...newestSalesFirst),
  ]);
  if (!stats || !profile) return null;
  return { ...stats, notes: profile.notes, sales: history.map(toSaleRow) };
}
