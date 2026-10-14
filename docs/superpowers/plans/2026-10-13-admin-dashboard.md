# Panel de admin — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel privado en `/admin` para que Tallami vea sus ingresos (USD y ARS), qué servicios se venden y cuáles no, sus alumnos, lo pendiente y el estado del monotributo, cargando ventas a mano hasta que existan los pagos online.

**Architecture:** Postgres con Drizzle ORM (Supabase en producción por `DATABASE_URL`; PGlite local y en tests). El panel vive en `src/app/admin/` con su propio layout raíz, fuera de next-intl, protegido por una sesión firmada (contraseña única). Las métricas son funciones puras sobre las ventas de los últimos 24 meses (volumen chico), probadas con datos fijos; las páginas son Server Components que leen la base y dibujan gráficos SVG en el servidor. Las acciones (alta, edición, facturar) son Server Actions validadas con zod.

**Tech Stack:** Next.js 16.4 (App Router, `cacheComponents`) · TypeScript · Tailwind 4 + CSS Modules · shadcn/ui · Drizzle ORM 0.45 + drizzle-kit 0.31 · postgres.js 3.4 · @electric-sql/pglite 0.5 · jose 6 · zod 4 · tsx (scripts) · Vitest · Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-13-admin-dashboard-design.md`

## Global Constraints

- Rama `feat/admin-dashboard`. Stage por ruta explícita; nunca `git add -A`/`git add .`. Commits convencionales en español con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Al terminar todo: merge a `main` y push sin preguntar (política del usuario).
- El sitio público no cambia salvo el registro de clics de la Tarea 8: `/es`, `/pt`, `/en` siguen estáticas (○ en `next build`) y toda la suite existente sigue en verde.
- `/admin` solo en español, fuera de `[locale]` y de next-intl; el `proxy` no le agrega prefijo de idioma.
- Base: `DATABASE_URL` → postgres.js con `{ prepare: false }`. Sin `DATABASE_URL` y sin `process.env.VERCEL` → PGlite en `process.env.PGLITE_DIR ?? ".data/pglite"`. En Vercel sin `DATABASE_URL` → página "falta configurar la base", nunca PGlite. Tests: PGlite en memoria con las migraciones aplicadas. `.data/` va al `.gitignore`.
- Dinero: siempre enteros en unidades menores (centavos); tipos de cambio como texto decimal con 4 decimales y aritmética con `BigInt`; redondeo half-up al centavo. Nada de `number` con decimales para montos.
- Fechas del negocio en `America/Argentina/Buenos_Aires`. Ingreso = venta `paid` o `delivered`, por `paid_on`.
- Seguridad: cada página y cada Server Action de `/admin` llama a `requireAdmin()`; toda entrada se valida con zod; nada de SQL armado a mano con texto del usuario; `/admin` con `noindex` y bloqueado en `robots.txt`.
- Tests sin red: el BCRA se reemplaza por `EXCHANGE_RATE_SOURCE=fixed` (USD y USDT 1500.0000, BRL 280.0000, ARS 1.0000) en e2e y por `fetch` simulado en unit; tweets con `TWEETS_SOURCE=snapshots`.
- Sin cambios de reloj en código de producción para tests (nada de "ahora" fijado por variable de entorno): los e2e calculan lo esperado con las mismas funciones puras y los mismos datos de ejemplo.
- E2e del panel: el servidor principal de Playwright (puerto 3100) arranca con una base PGlite vacía; los tests que escriben datos lo usan con nombres únicos y verifican solo sus propias filas, nunca que la base esté vacía (los tests corren en paralelo). Los estados vacíos se prueban a nivel de componente (render a HTML en Vitest, como `tests/unit/tweet-card.test.ts`). Los tests que verifican totales usan un segundo config (`playwright.demo.config.ts`, puerto 3101) con la base de ejemplo de la Tarea 7, que nadie modifica; `npm run test:e2e` corre los dos configs, el segundo reutilizando el build del primero.
- UI: marca del sitio (tokens de `src/app/globals.css`, Saira), shadcn/ui adaptado a esos tokens. Antes de escribir UI, leer `.claude/skills/frontend-design/SKILL.md`; para gráficos, la skill `dataviz` (herramienta Skill) si está disponible. Gráficos en SVG desde el servidor, sin librería de gráficos.
- Archivos con regex o `\u` se escriben con Write/Edit, nunca con heredoc. Servidores: cerrarlos por PID, nunca `taskkill /IM node.exe`; no tocar el puerto 3000.
- Datos de ejemplo solo locales: `npm run db:seed:demo` se niega a correr con `DATABASE_URL`.

## Review Focus

1. **Acceso sin sesión o con cookie falsa/vencida** a cualquier `/admin/*` o Server Action → redirige al login o responde 401; nunca datos. → Tarea 3 (e2e + unit).
2. **Venta cancelada, reembolsada o pendiente** → no suma en ningún total, gráfico ni monotributo. → Tarea 6 (unit) y Tarea 7 (e2e).
3. **Límites de mes en Argentina:** una venta cobrada el 31 a las 22:00 de Argentina cuenta en ese mes, no en el siguiente. → Tarea 6 (unit).
4. **BCRA caído, fin de semana o feriado:** se usa la última cotización anterior; si no hay, el formulario pide el valor manual y la venta igual se guarda. → Tarea 2 (unit) y Tarea 4 (e2e con fuente manual).
5. **Celular de 375 px:** el panel se usa sin scroll horizontal de página; las tablas anchas se desplazan dentro de su contenedor. → Tarea 10.

---

### Task 1: Base de datos

**Files:**
- Create: `drizzle.config.ts`, `drizzle/` (migraciones generadas), `src/db/schema.ts`, `src/db/client.ts`, `src/admin/catalog.ts`, `tests/helpers/db.ts`
- Modify: `package.json` (deps `drizzle-orm`, `postgres`, `@electric-sql/pglite`; devDeps `drizzle-kit`, `tsx`; scripts `db:generate`, `db:migrate`), `.gitignore` (`.data/`), `README.md` (una línea en la tabla de comandos por script nuevo)
- Test: `tests/unit/db-schema.test.ts`

**Interfaces:**
- Produces:
  - `src/admin/catalog.ts`: `SALE_ITEMS = ["vodRecorded","vodLive","lesson","lessonPack","gamePlan","tournament","proSeason","other"] as const`, `CURRENCIES = ["USD","ARS","BRL","USDT"] as const`, `PAYMENT_METHODS = ["mercadopago","pix","paypal","crypto","transfer","cash","other"] as const`, `SALE_STATUSES = ["pending","paid","delivered","cancelled","refunded"] as const`, `INCOME_STATUSES = ["paid","delivered"] as const`, `INVOICE_STATUSES = ["pending","issued","not_required"] as const`, `INVOICE_TYPES = ["C","E"] as const`, los tipos derivados (`SaleItem`, `Currency`, …) y etiquetas en español `ITEM_LABELS`, `PAYMENT_LABELS`, `STATUS_LABELS`, `INVOICE_STATUS_LABELS`. `suggestedPriceUsd(item: SaleItem): number | null` (USD enteros desde `src/content/services.ts`: lessonPack = `LESSON_PACK.priceUsd`, proSeason = `PRO_SEASON.priceUsd`, other = null).
  - `src/db/schema.ts` (Drizzle, columnas snake_case en la base):
    - `customers`: `id uuid pk default gen_random_uuid()`, `name text not null`, `discord text`, `email text`, `country char(2)` (ISO alfa-2 en mayúsculas), `notes text`, `created_at timestamptz not null default now()`.
    - `sales`: `id uuid pk`, `customer_id uuid not null → customers (restrict)`, `item text not null` (check en `SALE_ITEMS`), `description text` (check: obligatoria si `item = 'other'`), `currency text not null` (check), `amount_minor bigint not null` (check > 0), `ars_per_unit numeric(14,4) not null`, `ars_per_usd numeric(14,4) not null`, `rate_source text not null` (check `bcra`|`manual`|`fixed`), `rate_quoted_on date`, `amount_ars_minor bigint not null`, `amount_usd_minor bigint not null`, `payment_method text not null` (check), `status text not null` (check), `paid_on date` (check: obligatoria si `status` en paid/delivered/refunded), `due_at timestamptz`, `delivered_at timestamptz`, `invoice_status text not null default 'pending'` (check), `invoice_type text` (check C|E), `invoice_number text`, `invoiced_on date` (check: tipo, número y fecha obligatorios si `invoice_status = 'issued'`), `source text not null default 'manual'`, `notes text`, `created_at`, `updated_at timestamptz not null default now()`. Índices: `(paid_on)`, `(customer_id)`, `(status)`, `(invoice_status)`.
    - `settings`: `key text pk`, `value jsonb not null`, `updated_at timestamptz not null default now()`.
    - `exchange_rates`: `currency text`, `quoted_on date`, `ars_per_unit numeric(14,4) not null`, `source text not null`, `fetched_at timestamptz not null default now()`, pk `(currency, quoted_on)`.
    - `login_attempts`: `id bigserial pk`, `ip_hash text not null`, `succeeded boolean not null`, `created_at timestamptz not null default now()`, índice `(ip_hash, created_at)`.
  - `src/db/client.ts`: `type Db` (tipo común de Drizzle para ambos drivers, con el schema) y `getDb(): Promise<Db>` (singleton por proceso; elige driver según Global Constraints; PGlite aplica las migraciones de `drizzle/` al abrir). `DbNotConfiguredError` cuando corre en Vercel sin `DATABASE_URL`.
  - `tests/helpers/db.ts`: `createTestDb(): Promise<Db>` (PGlite en memoria + migraciones).

- [ ] **Step 1: Tests que fallan** (`tests/unit/db-schema.test.ts`, con `createTestDb()`):
```ts
test("migrations create every table", …)  // las 5 tablas existen
test("a sale needs a positive amount", …)  // insert con amount_minor 0 → error de check
test("an 'other' sale needs a description", …)
test("a paid sale needs paid_on", …)
test("an issued invoice needs type, number and date", …)
test("a customer with sales cannot be deleted", …)  // FK restrict
test("suggested prices come from the site catalog", …)
  // vodRecorded 30, vodLive 45, lesson 40, lessonPack 140, gamePlan 120, tournament 150, proSeason 2500, other null
```
- [ ] **Step 2:** correr y ver que fallan. **Step 3:** implementar y generar la migración con `npm run db:generate`. **Step 4:** `npm run test && npm run lint && npm run typecheck` → PASS; `next build` sin cambios en las páginas públicas. **Step 5: Commit** — `feat: base de datos del panel con Drizzle (Supabase en producción, PGlite local)`.

---

### Task 2: Dinero y tipo de cambio

**Files:**
- Create: `src/lib/money.ts`, `src/admin/exchange-rate.ts`, `tests/fixtures/bcra/*.json` (respuestas reales grabadas del BCRA: USD y BRL de un rango que incluya un fin de semana)
- Test: `tests/unit/money.test.ts`, `tests/unit/exchange-rate.test.ts`

**Interfaces:**
- Consumes: `Db`, `exchange_rates`, `Currency` (Tarea 1).
- Produces:
  - `parseAmountToMinor(input: string): number` — acepta `"1.234,56"`, `"1234,56"`, `"1234.56"`, `"1234"`; tira error con mensaje en español si no es un monto positivo con hasta 2 decimales.
  - `formatMoney(minor: number, currency: Currency, opts?: { decimals?: 0 | 2 }): string` — es-AR: USD → `"USD 1.234,56"`, ARS → `"$ 1.234,56"`, BRL → `"R$ 1.234,56"`, USDT → `"USDT 1.234,56"`.
  - `convertToArsMinor(amountMinor: number, arsPerUnit: string): number` y `arsToUsdMinor(arsMinor: number, arsPerUsd: string): number` — BigInt, half-up.
  - `type Rate = { arsPerUnit: string; quotedOn: string; source: "bcra" | "fixed" }`; `getArsPerUnit(db: Db, currency: Currency, date: string): Promise<Rate | null>` — ARS → `"1.0000"`; USDT usa USD; con `EXCHANGE_RATE_SOURCE=fixed` devuelve los valores fijos de Global Constraints, salvo para fechas anteriores a `2020-01-01`, donde devuelve `null` (así los e2e prueban la carga manual); si no, busca en `exchange_rates` y si falta pide al BCRA el rango `[date − 10 días, date]` con timeout de 5 s, guarda todas las cotizaciones recibidas y devuelve la última en o antes de `date`; `null` si falla o no hay.

- [ ] **Step 1: Tests que fallan**
```ts
test("parses spanish and plain amounts", …)  // "1.234,56"→123456, "1234.56"→123456, "40"→4000; "-5","abc","1,234" (3 dec ambiguo) → error
test("formats money in es-AR", …)  // los cuatro ejemplos de arriba
test("converts with exact cents", …)  // convertToArsMinor(4000,"1517.0000") === 6068000; arsToUsdMinor(6068000,"1517.0000") === 4000; half-up en un caso con resto .5
test("uses the last BCRA quote on or before a weekend date", …)  // fixture con viernes y sábado sin cotización
test("caches quotes and does not call the BCRA twice", …)
test("returns null when the BCRA fails", …)  // fetch que rechaza y fetch con 500
test("fixed source never calls fetch", …)
```
- [ ] **Step 2–4** como siempre (fallan, implementar, pasan + lint + typecheck). **Step 5: Commit** — `feat: montos en centavos y tipo de cambio oficial del BCRA con caché`.

---

### Task 3: Acceso al panel

**Files:**
- Create: `src/admin/auth/password.ts`, `src/admin/auth/session.ts`, `src/admin/auth/rate-limit.ts`, `src/admin/auth/require-admin.ts`, `scripts/admin-password.ts`, `src/app/admin/layout.tsx` (layout raíz del panel: `<html lang="es">`, fuente, `noindex`), `src/app/admin/login/page.tsx` (+ acción de login), `src/app/admin/page.tsx` (provisoria: "Panel" + botón Salir; la Tarea 7 la reemplaza), `src/app/admin/setup/page.tsx` (falta configurar base o variables)
- Modify: `src/proxy.ts` (rutas `/admin` fuera de next-intl; sin cookie de sesión válida → redirect a `/admin/login?next=…`), `src/app/robots.ts` (`disallow: /admin`), `playwright.config.ts` (env de prueba: `ADMIN_PASSWORD_HASH` calculado desde una contraseña de prueba definida en `tests/helpers/admin.ts`, `ADMIN_SESSION_SECRET` de prueba, `PGLITE_DIR` en una carpeta temporal que se borra al iniciar, `EXCHANGE_RATE_SOURCE=fixed`), `package.json` (deps `jose`, `zod`; script `admin:password`), `.env.example`, `README.md`
- Test: `tests/unit/admin-auth.test.ts`, `tests/e2e/admin-auth.spec.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>` (scrypt de `node:crypto`, formato `scrypt$N$r$p$saltB64$hashB64`), `verifyPassword(plain: string, stored: string): Promise<boolean>` (comparación de tiempo constante); `ADMIN_COOKIE = "tallami_admin"`, `createSessionToken(): Promise<string>` y `verifySessionToken(token: string | undefined): Promise<boolean>` (jose HS256, 12 h, `aud: "tallami-admin"`); `hashIp(ip: string): string` (HMAC con el secreto de sesión); `isLoginBlocked(db, ipHash, now: Date): Promise<boolean>` (≥ 5 fallidos en 15 min) y `recordLoginAttempt(db, ipHash, succeeded)`; `requireAdmin(): Promise<void>` (lee la cookie y redirige a `/admin/login` si no es válida; usar en cada página y Server Action del panel).
- Si faltan `ADMIN_PASSWORD_HASH` o `ADMIN_SESSION_SECRET` (o el secreto tiene < 32 caracteres), `/admin/*` lleva a `/admin/setup`, que explica qué variable falta sin mostrar valores.

- [ ] **Step 1: Tests que fallan**
```ts
// unit
test("verifies the right password and rejects the wrong one", …)
test("rejects tampered, expired or foreign-audience tokens", …)
test("blocks an ip after five failures in fifteen minutes and frees it after", …)
// e2e
test("admin pages redirect to login without a session", …)  // /admin, /admin/ventas → /admin/login
test("a forged cookie does not open the panel", …)
test("wrong password shows an error and five failures lock the form", …)
test("right password opens the panel and logout closes it", …)
test("cookie is httpOnly, SameSite=Strict and scoped to /admin", …)
test("admin pages are noindex and robots.txt disallows /admin", …)
test("public pages stay the same", …)  // /es sigue respondiendo 200 y sin enlaces a /admin
```
- [ ] **Step 2–4.** Confirmar con `next build` que `/es` `/pt` `/en` siguen ○ estáticas. **Step 5: Commit** — `feat: acceso al panel con contraseña, sesión firmada y límite de intentos`.

---

### Task 4: Estructura del panel y ventas

**Files:**
- Create: `src/admin/ui/` (shell: barra lateral con Resumen, Ventas, Servicios, Alumnos, Facturación, Configuración y Salir; menú desplegable ≤ 900 px; encabezado de página; estado vacío), componentes shadcn necesarios (`npx shadcn@4.21.4 add table input select dialog badge label textarea`) adaptados a los tokens, `src/admin/sales/schema.ts` (zod), `src/admin/sales/repository.ts`, `src/admin/customers/repository.ts`, `src/app/admin/ventas/page.tsx`, `src/app/admin/ventas/nueva/page.tsx`, `src/app/admin/ventas/[id]/page.tsx`, Server Actions de ventas
- Test: `tests/unit/sales-repository.test.ts`, `tests/e2e/admin-sales.spec.ts`

**Interfaces:**
- Consumes: Tareas 1–3.
- Produces:
  - `saleInputSchema` (zod) con mensajes en español: alumno existente o nuevo (`{ name, discord?, country? }`), `item`, `description?`, `currency`, `amount` (texto → `parseAmountToMinor`), `paymentMethod`, `status`, `paidOn?`, `dueAt?`, `deliveredAt?`, `rateMode: "auto" | "manual"`, `arsPerUnit?`/`arsPerUsd?` (obligatorios en manual), `notes?`.
  - `createSale(db, input, rates): Promise<{ id: string }>` y `updateSale(db, id, input, rates)` — calculan `amount_ars_minor` y `amount_usd_minor`; `listSales(db, filter: SaleFilter, page: number, pageSize = 25): Promise<{ rows: SaleRow[]; total: number }>` con `SaleFilter = { from?; to?; item?; status?; paymentMethod?; invoiceStatus?; q? }` (q busca en nombre o discord del alumno, sin distinguir mayúsculas); `getSale(db, id)`.
  - `searchCustomers(db, q, limit = 8)`, `createCustomer(db, input)`.
- Formulario: precio sugerido al elegir el ítem; al guardar con `rateMode: auto` pide `getArsPerUnit` para la moneda y USD en `paidOn` (o hoy); si devuelve `null`, vuelve al formulario con el error "No pudimos traer el dólar oficial; cargalo a mano" y los campos manuales visibles. Muestra los equivalentes en ARS y USD guardados.

- [ ] **Step 1: Tests que fallan**
```ts
// unit (PGlite)
test("creates a USD sale with its ARS and USD values", …)  // 40 USD a 1500 → ars 6000000, usd 4000
test("creates an ARS sale converting to USD", …)
test("filters by date, item, status, method, invoice and customer text", …)
test("paginates newest first by paid_on then created_at", …)
// unit (componente)
test("empty sales table invites to add the first sale", …)
// e2e (fuente fija, nombres únicos)
test("adds a sale with a new student and sees it in the list", …)
test("suggested price fills when picking a service", …)  // Plan de juego → 120
test("manual rate is required when the automatic one is unavailable", …)
  // fecha de cobro 2019-12-31: la fuente fija devuelve null → aparece el aviso y los campos manuales; con valores manuales se guarda
test("edits a sale status to delivered", …)
test("rejects invalid input with spanish messages", …)  // monto "abc", "Otro" sin descripción
test("sales list scrolls inside its container on a 375px phone", …)
```
- [ ] **Step 2–4.** **Step 5: Commit** — `feat: estructura del panel y carga de ventas con alumnos`.

---

### Task 5: Alumnos

**Files:**
- Create: `src/app/admin/alumnos/page.tsx`, `src/app/admin/alumnos/[id]/page.tsx`, `src/app/admin/alumnos/nuevo/page.tsx`, ampliar `src/admin/customers/repository.ts`
- Test: `tests/unit/customers-repository.test.ts`, `tests/e2e/admin-customers.spec.ts`

**Interfaces:**
- Produces: `listCustomersWithStats(db, q?): Promise<CustomerStats[]>` con `CustomerStats = { id, name, discord, country, purchases: number, totalUsdMinor: number, firstPaidOn: string | null, lastPaidOn: string | null, items: SaleItem[] }` (solo ventas de ingreso), orden por última compra; `getCustomer(db, id)` con su historial completo de ventas (todas, con estado); `updateCustomer(db, id, input)`.

- [ ] **Step 1: Tests que fallan**
```ts
test("customer stats count only income sales", …)  // una cancelada no suma
test("orders customers by last purchase", …)
// e2e
test("lists students with totals and opens a student's history", …)
test("edits a student's discord and country", …)
```
- [ ] **Step 2–4.** **Step 5: Commit** — `feat: alumnos con historial y total gastado`.

---

### Task 6: Métricas

**Files:**
- Create: `src/admin/metrics/period.ts`, `src/admin/metrics/kpis.ts`, `src/admin/metrics/series.ts`, `src/admin/metrics/pending.ts`, `src/admin/metrics/monotributo.ts`, `src/admin/metrics/load.ts`
- Test: `tests/unit/metrics.test.ts`

**Interfaces:**
- Produces (funciones puras salvo `load.ts`):
  - `type MetricSale = { id; customerId; item: SaleItem; status: SaleStatus; paidOn: string | null; dueAt: string | null; deliveredAt: string | null; amountArsMinor: number; amountUsdMinor: number; paymentMethod; country: string | null; invoiceStatus }`.
  - `type Period = "thisMonth" | "lastMonth" | "last30" | "last12" | "thisYear"`; `todayInArgentina(now: Date): string`; `periodRange(period, now): { from: string; to: string }` (fechas `YYYY-MM-DD` inclusivas en Argentina) y `previousRange(range)` (mismo largo, inmediatamente antes; para meses calendario, el mes anterior completo).
  - `isIncome(sale)`; `computeKpis(sales, period, now)` → `{ incomeUsdMinor, incomeArsMinor, incomeUsdDeltaPct: number | null, salesCount, avgTicketUsdMinor, newCustomers, repeatRatePct }` (delta null si el período anterior es 0; recompra = alumnos del período con una compra de ingreso anterior al período / alumnos del período).
  - `monthlyIncome(sales, months: number, now)` → `{ month: "YYYY-MM"; usdMinor; arsMinor }[]` (incluye meses en 0, del más viejo al actual).
  - `incomeByItem(sales, range)` → `{ item; count; usdMinor; sharePct }[]` ordenado por `usdMinor`; `itemsWithoutSales(sales, days = 90, now)` → `SaleItem[]` (catálogo sin `other`).
  - `incomeByPaymentMethod(sales, range)`, `incomeByCountry(sales, range)` (país null = "Sin país").
  - `pendingWork(sales, now)` → `{ deliveries: { id; dueAt; overdue: boolean }[]; sessions: { id; dueAt }[]; uninvoiced: { count; arsMinor; usdMinor } }` — entregas = `vodRecorded` y `gamePlan` cobradas sin `deliveredAt` (por `dueAt`); sesiones = `vodLive`, `lesson`, `lessonPack`, `tournament`, `proSeason` con `dueAt` en los próximos 7 días; sin facturar = ingresos con `invoiceStatus = "pending"`.
  - `monotributoStatus(sales, settings: { category: string; annualCapArsMinor: number; validFrom: string } | null, now)` → `{ last12ArsMinor; capArsMinor: number | null; usedPct: number | null; remainingArsMinor: number | null }` (últimos 12 meses móviles por `paidOn`, hasta hoy).
  - `load.ts`: `loadMetricSales(db, now): Promise<MetricSale[]>` (ventas de los últimos 24 meses + todas las no entregadas/sin facturar, con el país del alumno).

- [ ] **Step 1: Tests que fallan** (datos fijos, `now` = 2026-10-13 15:00 Argentina):
```ts
test("only paid and delivered sales are income", …)  // pending, cancelled, refunded no suman en kpis, series, ítems ni monotributo
test("a sale paid on the 31st at 22:00 in Argentina belongs to that month", …)  // paidOn es fecha; el caso borde es todayInArgentina con now = 1 de noviembre 01:30 UTC → "2026-10-31"
test("this month vs last month delta", …)  // 300 USD vs 200 USD → 50
test("delta is null when the previous period had no income", …)
test("monthly series has 12 months including empty ones", …)
test("income by item is sorted and shares add up to 100", …)
test("items without sales in 90 days excludes other", …)
test("repeat rate counts customers with an earlier purchase", …)
test("pending work: overdue deliveries, sessions in 7 days, uninvoiced totals", …)
test("monotributo uses the rolling last 12 months against the cap", …)
test("monotributo without settings returns only the total", …)
```
- [ ] **Step 2–4.** **Step 5: Commit** — `feat: métricas del panel (ingresos, servicios, pendientes y monotributo)`.

---

### Task 7: Resumen

**Files:**
- Create: `src/admin/charts/` (`BarChart` vertical por mes, `HBarChart` horizontal, `Meter` de progreso, `DeltaBadge`; SVG desde el servidor, accesibles con `<title>`/`<desc>` y tabla o lista alternativa para lectores de pantalla), `src/app/admin/page.tsx` (reemplaza la provisoria), `scripts/seed-demo.ts`, `src/admin/demo-data.ts` (generador determinístico relativo a una fecha), `playwright.demo.config.ts` (puerto 3101, carpeta PGlite propia sembrada con `buildDemoData` antes de arrancar, mismo build)
- Modify: `package.json` (script `db:seed:demo`; `test:e2e` corre los dos configs)
- Test: `tests/unit/demo-data.test.ts`, `tests/e2e/admin-overview.spec.ts`

**Interfaces:**
- Consumes: Tareas 4 y 6.
- Produces: `buildDemoData(today: string)` → `{ customers; sales }` (≈ 25 alumnos ficticios "Alumno de prueba N", ≈ 120 ventas en 14 meses, todos los ítems salvo uno sin ventas en 90 días, algunas canceladas, pendientes y sin facturar); `seed-demo.ts` lo inserta con `getDb()` y se niega con `DATABASE_URL`.
- Página: selector de período por `?periodo=` (`este-mes`, `mes-pasado`, `30-dias`, `12-meses`, `este-ano`), tarjetas, barras por mes, ingresos por servicio + "Sin ventas en 90 días", medios de pago y países, pendientes con links a cada venta, monotributo (si no hay configuración: link a Configuración). Estado vacío sin ventas.

- [ ] **Step 1: Tests que fallan**
```ts
test("demo data is deterministic and leaves one item without recent sales", …)
test("overview renders the empty state without sales", …)  // componente, render a HTML
// e2e con playwright.demo.config.ts (base = buildDemoData(hoy en Argentina), solo lectura)
test("overview shows the KPIs computed from the demo data", …)  // compara con computeKpis sobre buildDemoData
test("period selector changes the KPIs", …)
test("monthly chart has 12 bars with accessible labels", …)
test("items without sales are listed", …)
test("pending deliveries link to their sale", …)
```
- [ ] **Step 2–4.** Capturas a 375 y 1440 px para el reporte. **Step 5: Commit** — `feat: resumen del panel con ingresos, servicios, pendientes y monotributo`.

---

### Task 8: Servicios e interés por servicio

**Files:**
- Create: `src/app/admin/servicios/page.tsx`, `src/app/api/interest/route.ts`, `src/components/home/booking-link.tsx` (cliente: envía el beacon y navega igual que hoy), tabla `interest_events` (`id bigserial`, `item text`, `locale text`, `country char(2)`, `ip_hash text`, `created_at`) + migración
- Modify: `src/components/home/services-menu.tsx` (los CTA usan `BookingLink`), `src/proxy.ts` si hace falta para `/api`
- Test: `tests/unit/interest.test.ts`, `tests/e2e/interest.spec.ts`, `tests/e2e/admin-services.spec.ts`

**Interfaces:**
- Produces: `POST /api/interest` con JSON `{ item: SaleItem sin "other"; locale: "es" | "pt" | "en" }` → 204; 400 si no valida; descarta user-agents de bots (lista corta documentada) y > 30 eventos por minuto por `ipHash`; nunca guarda la IP en claro. `interestByItem(db, range)` → `{ item; clicks }[]`. Página Servicios: por ítem del catálogo, ventas, ingresos, ticket promedio, porcentaje del total, tendencia 6 meses (mini barras), última venta, clics y conversión (`ventas / clics`, "—" sin clics), con el selector de período del Resumen.

- [ ] **Step 1: Tests que fallan**
```ts
test("accepts a valid click and stores it without the raw ip", …)
test("rejects unknown items and bots, and rate-limits bursts", …)
// e2e sitio público
test("clicking Reservar on a service sends one beacon and still goes to #services", …)
test("public pages stay static", …)  // el HTML de /es no cambia de modo (sin fetch al cargar)
// e2e panel
test("services page shows clicks, sales and conversion", …)
```
- [ ] **Step 2–4** (incluye `next build`: `/es` `/pt` `/en` ○). **Step 5: Commit** — `feat: interés por servicio y página de servicios del panel`.

---

### Task 9: Facturación, configuración y exportación

**Files:**
- Create: `src/app/admin/facturacion/page.tsx`, `src/app/admin/configuracion/page.tsx`, `src/admin/settings/repository.ts`, `src/admin/export/csv.ts`, `src/app/admin/ventas/exportar/route.ts`, `src/app/admin/facturacion/exportar/route.ts`, Server Actions de facturación y configuración
- Test: `tests/unit/csv.test.ts`, `tests/unit/settings.test.ts`, `tests/e2e/admin-billing.spec.ts`

**Interfaces:**
- Produces: `getMonotributoSettings(db)`/`saveMonotributoSettings(db, { category: "A"…"K"; annualCapArs: string; validFrom: string })`; `markInvoiced(db, ids: string[], invoice: { type: "C" | "E"; number: string; issuedOn: string })` y `markInvoiceNotRequired(db, ids)` (solo ventas de ingreso con factura pendiente; las demás se rechazan); `salesToCsv(rows): string` — separador `;`, coma decimal, BOM UTF-8, encabezados en español (Fecha de cobro, Alumno, País, Servicio, Descripción, Moneda, Monto, Pesos, Dólares, Tipo de cambio, Fuente, Medio de pago, Estado, Factura, Tipo, Número, Fecha de factura), escape de celdas que empiezan con `=`, `+`, `-` o `@` (prefijo `'`) y de comillas/`;`/saltos de línea. Ambos endpoints de exportación llaman a `requireAdmin()` y respetan los filtros de la query.
- Facturación: ventas cobradas sin factura agrupadas por mes (totales ARS y USD), selección múltiple, marcar facturadas o "no requiere", resumen mensual de 12 meses cobrado contra facturado, tarjeta de monotributo. Configuración: formulario de monotributo con link a la tabla vigente de ARCA (verificar la URL), fecha de última actualización.

- [ ] **Step 1: Tests que fallan**
```ts
test("csv uses semicolons, comma decimals and a BOM", …)
test("csv escapes formula-looking cells and quotes", …)  // "=HYPERLINK(...)" → "'=HYPERLINK(...)"
test("markInvoiced requires paid sales with a pending invoice", …)
test("saves and reads monotributo settings", …)
// e2e
test("marks two sales as invoiced and they leave the pending list", …)
test("export downloads the filtered sales as csv", …)
test("export endpoints require a session", …)
test("monotributo meter appears after saving settings", …)
```
- [ ] **Step 2–4.** **Step 5: Commit** — `feat: facturación, monotributo y exportación CSV para el contador`.

---

### Task 10: Calidad, seguridad y guía

**Files:**
- Modify: lo que haga falta en `src/admin/**` y `src/app/admin/**`; `README.md` (sección "Panel de admin": qué es, cómo entrar localmente con PGlite y `db:seed:demo`, cómo generar la contraseña, variables de entorno, cómo crear el proyecto de Supabase y correr `db:migrate`, qué hacer en Vercel)
- Test: `tests/e2e/admin-quality.spec.ts`

- [ ] **Step 1:** e2e con sesión: axe (wcag2a/2aa/21aa/22aa, sin serias ni críticas) en Resumen, Ventas, Nueva venta, Alumnos, Servicios, Facturación y Configuración a 375 y 1440 px; sin scroll horizontal de página a 375, 768 y 1440; navegación con teclado del menú lateral y del menú desplegable en celular; foco visible.
- [ ] **Step 2:** repaso de seguridad con la skill `security-review` (leer `.claude/skills/` o la skill global): cada Server Action y route handler del panel llama a `requireAdmin()` (un test que recorre `src/app/admin/**` y falla si un archivo de acción o ruta no lo importa), validación zod, ningún dato del panel en el HTML público, cookies, límite de intentos.
- [ ] **Step 3:** suite completa (`npm run lint && npm run typecheck && npm run test && npm run test:e2e`) y `next build` sin warnings con `/es` `/pt` `/en` ○ estáticas.
- [ ] **Step 4: Commit** — `docs: guía del panel de admin` (y `fix:` por lo que haya hecho falta arreglar).
