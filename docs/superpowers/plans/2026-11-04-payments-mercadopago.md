# Pagos con Mercado Pago — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un alumno en Argentina compre cualquier servicio desde la web con Mercado Pago, que la venta aparezca sola en el panel, que Temporada Pro funcione por aplicación y link de pago, y que la web tenga lo legal que hace falta para cobrar.

**Architecture:** Todo pago pasa por una tabla `orders` y una interfaz de proveedor (`src/payments/provider.ts`): nada fuera de `src/payments/` conoce a Mercado Pago, salvo la ruta del aviso. Una sola función (`applyProviderPayment`) lleva un pago a su venta, y la llaman tanto el aviso firmado como el respaldo al volver al portal. La portada sigue prerenderizada: el valor de pesos por dólar se lee con `use cache` + `cacheTag` y guardarlo lo invalida.

**Tech Stack:** Next.js 16.4.3 (App Router, `cacheComponents`, Server Actions, route handlers), next-intl, TypeScript, Drizzle + PGlite/postgres.js, zod, Resend 6.34, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-payments-mercadopago-design.md` (leerlo entero antes de cada tarea).

## Global Constraints

- Rama `feat/payments-mercadopago`. Commits por tarea o grupo, mensajes convencionales en español, staging por ruta explícita (nunca `git add -A`), cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Valores, una sola vez en `src/payments/policy.ts`: el pago vence a la **1 hora**; **1 cuota**; sin `ticket`; entrega **72 h** (`vodRecorded`) y **96 h** (`tournamentReview`) desde los códigos; compras sin usar vencen a los **150 días** de `paidOn`; link de Temporada Pro **14 días**, un solo uso, guardado como hash; pedidos sin pagar se borran a los **90 días**; aplicaciones y pedidos del sitio a los **24 meses**; códigos de replay hasta **4000** caracteres.
- Horario publicado: "lunes a viernes, de 10 a 18, hora de Argentina".
- **En ningún texto de la web:** CUIT, email ni dirección de Tallami. Su nombre sí: Tomás Allami ("Tallami"). Nunca "sin reembolsos" ni parecidos.
- Dinero: enteros en unidades menores, cuentas con `src/lib/money.ts`. El precio en pesos es dólares × valor, redondeado al peso entero, sin redondeos "lindos".
- El servidor toma servicio, precio y valor de sus propias fuentes. Del navegador solo llegan qué servicio, la casilla, el monto que vio (para compararlo) y el token del link.
- Nunca creerle al cuerpo del aviso ni a los parámetros de vuelta (`status`, `payment_id` solo sirven para saber qué consultar): el estado sale siempre de consultar el pago en la API.
- Variables nuevas: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `PUBLIC_EMAIL_FROM`; solo para tests y desarrollo `MERCADOPAGO_API_BASE`, ignorada en Vercel (`process.env.VERCEL`), como `PORTAL_OAUTH_TEST_ISSUER`.
- Sitio público: `/es`, `/pt`, `/en` siguen prerenderizadas (lo cuida `tests/e2e/interest.spec.ts`, "still prerendered"). El panel solo en español; lo demás en es/pt/en con voseo en español.
- Panel: `requireAdmin()` primero en toda página, acción o ruta nueva (`tests/unit/admin-guards.test.ts`). Portal y compra: cada acción lee la sesión y verifica el dueño. Lo de otro alumno es un 404 sin pista.
- Tablas nuevas con `.enableRLS()`. **Una sola migración,** `drizzle/0008_payments_mercadopago.sql`, en la Tarea 2.
- Logs sin datos personales, tokens ni montos: solo tipo de error e ids internos.
- Tests sin red. `DATABASE_URL` vacía en todo lo que se corra. Write/Edit (escapes `\u`, nunca NUL ni BOM literal), no heredocs. Servidores por PID; nunca `taskkill /IM node.exe`; el puerto 3000 es de Tallami; nunca leer, imprimir ni cambiar `.env.local`; nunca tocar `.data/pglite`.
- Documentación por context7 (`/vercel/next.js`, `/websites/mercadopago_br_developers_pt`), no de memoria. Textos de venta: skill `copywriting`, sin inventar datos. UI: skill `frontend-design`, dentro de la marca (`stage`, `paper`, dorado, Saira).

## Review Focus

1. **El valor de pesos por dólar cambia entre que el alumno ve la pantalla y toca pagar:** no se cobra otro monto; vuelve a la pantalla con el precio nuevo y un aviso. Test en la Tarea 4.
2. **Doble clic en pagar, o volver atrás y pagar de nuevo:** dos pedidos, y solo el que se paga hace venta; un mismo pago avisado dos veces hace una sola. Tests en las Tareas 3 y 4.
3. **La sesión vence con la pantalla abierta, o Mercado Pago está caído al tocar pagar:** nunca un 500. Sin sesión, vuelve a pedir el ingreso y regresa a la misma pantalla; con el proveedor caído, el pedido queda cancelado y se puede reintentar. Test en la Tarea 4.
4. **Los avisos llegan fuera de orden** (el reembolso antes que la aprobación que nunca llegó): queda una sola venta, reembolsada, con su registro. Test en la Tarea 3.
5. **Texto hostil en un campo público** (códigos de replay o un formulario con `<script>`, 100 KB o solo espacios): se rechaza por largo o vacío y, si entra, se muestra como texto en el panel. Tests en las Tareas 5, 6 y 7.

---

### Task 1: Pesos por dólar y los dos precios en la portada

**Files:**
- Create: `src/payments/pricing.ts`, `src/payments/cached-rate.ts`
- Modify: `src/lib/format.ts`, `src/components/home/services-menu.tsx`, `src/components/home/services-menu.module.css`, `src/admin/settings/settings-view.tsx`, `src/app/admin/configuracion/actions.ts`, `src/app/admin/configuracion/page.tsx`
- Test: `tests/unit/payments-pricing.test.ts`, `tests/e2e/payments-prices.spec.ts`

**Interfaces:**
- Produces (`pricing.ts`): `PESOS_PER_DOLLAR_SETTING_KEY = "pesosPerDollar"`; `PESOS_PER_DOLLAR_TAG = "pesos-per-dollar"`; `getPesosPerDollar(db: Db): Promise<{ rate: string; updatedAt: Date } | null>` (lo guardado mal o no positivo es `null`); `savePesosPerDollar(db: Db, input: string): Promise<{ saved: true; rate: string } | { saved: false; error: string }>` (usa `parseRateInput`); `pesosForUsd(usdMinor: number, rate: string): number` (centavos de peso, múltiplo de 100).
- Produces (`cached-rate.ts`): `getPublicPesosPerDollar(): Promise<string | null>`.
- Produces (`format.ts`): `formatArs(amountMinor: number, locale: Locale): string` ("ARS 45.000", en inglés "ARS 45,000").

- [ ] **Step 1: Tests unitarios que fallan.** `pesosForUsd(3000, "1500.0000")` da `4_500_000`; `pesosForUsd(3000, "1234.5600")` da `3_703_700` (37.036,80 redondea a 37.037); `pesosForUsd(250000, "1500.0000")` da `375_000_000`. `savePesosPerDollar` con `"1.500,50"` guarda y `getPesosPerDollar` lo devuelve; con `"0"`, `"abc"` y `""` devuelve `saved: false` y no escribe; guardar de nuevo reemplaza y mueve `updatedAt`. Una fila con `value` de otra forma se lee como `null`.
- [ ] **Step 2:** correrlos (`npx vitest run tests/unit/payments-pricing.test.ts`) → FALLAN.
- [ ] **Step 3: Implementar `pricing.ts` y `formatArs`.**
- [ ] **Step 4: Implementar `getPublicPesosPerDollar`.** Función con `"use cache"`, `cacheTag(PESOS_PER_DOLLAR_TAG)` y `cacheLife("max")`. Durante el build (`process.env.NEXT_PHASE === "phase-production-build"`) sin `DATABASE_URL` devuelve `null` sin abrir la base: abrir PGlite ahí chocaría con un servidor de desarrollo en la misma carpeta. Ante un error de la base devuelve `null` con `cacheLife("minutes")`, como `getTweetCards`, para no guardar el fallo para siempre.
- [ ] **Step 5: Panel.** Configuración suma una tarjeta "Pesos por dólar": el valor, cuándo se guardó y un formulario. La acción (`savePesosPerDollarAction`) empieza con `requireAdmin()` y, si guardó, llama `updateTag(PESOS_PER_DOLLAR_TAG)`.
- [ ] **Step 6: Portada.** `ServicesMenu` lee `getPublicPesosPerDollar()`. Cada precio, Temporada Pro incluida, muestra debajo del de dólares el de pesos con **el mismo tamaño** y `data-testid="price-ars"`. El de dólares sigue en `data-testid="price"`. Sin valor, solo dólares.
- [ ] **Step 7: e2e que falla y pasa.** `tests/e2e/payments-prices.spec.ts`: entra al panel, guarda `1500`, y `/es` muestra `ARS 45.000` para el VOD de 3 partidas y `ARS 3.750.000` para Temporada Pro; `/en` muestra `ARS 45,000`. El de pesos y el de dólares miden igual (`font-size` computado). Correr también `tests/e2e/interest.spec.ts` y `tests/e2e/home-paper.spec.ts`.

  Run: `npx playwright test tests/e2e/payments-prices.spec.ts tests/e2e/interest.spec.ts tests/e2e/home-paper.spec.ts`
  Expected: PASS, incluido "still prerendered".
- [ ] **Step 8: Commit** `feat: pesos por dólar en el panel y los dos precios en la portada`.

### Task 2: Tablas, política y cliente de Mercado Pago

**Files:**
- Create: `src/payments/policy.ts`, `src/payments/provider.ts`, `src/payments/mercadopago.ts`, `drizzle/0008_payments_mercadopago.sql` (generada)
- Modify: `src/db/schema.ts`, `src/portal/accounts.ts`, `src/portal/oauth/providers.ts`, `.env.example`
- Test: `tests/unit/payments-mercadopago.test.ts`, `tests/unit/portal-accounts.test.ts`, `tests/unit/db-rls.test.ts`

**Interfaces:**
- Produces (schema):
  - `orders`: `id uuid pk`, `provider` (check `PAYMENT_PROVIDERS`), `accountId uuid null → portal_accounts on delete set null`, `buyerName not null`, `buyerEmail null`, `buyerHandle null`, `item` (check `SALE_ITEMS`), `amountUsdMinor bigint`, `arsPerUsd numeric(14,4)`, `amountArsMinor bigint`, `status default 'created'` (check `ORDER_STATUSES`), `providerPaymentId null`, `unique(provider, providerPaymentId)`, `adultConfirmedAt not null`, `locale` (check), `saleId uuid null → sales on delete set null`, `proPaymentLinkId uuid null → pro_payment_links on delete set null`, `createdAt`, `updatedAt`, `expiresAt`. Índices en las claves foráneas y en `(status, createdAt)`.
  - `proApplications` (`pro_applications`): `id`, `name`, `discord`, `teamMembers`, `results`, `message null`, `status default 'new'` (check `PRO_APPLICATION_STATUSES`), `locale`, `ipHash null`, `createdAt`, `updatedAt`.
  - `proPaymentLinks` (`pro_payment_links`): `id`, `applicationId → pro_applications on delete cascade`, `tokenHash unique`, `amountUsdMinor bigint`, `createdAt`, `expiresAt`, `paidAt null`.
  - `siteRequests` (`site_requests`): `id`, `kind` (check `SITE_REQUEST_KINDS`), `code unique`, `name`, `email`, `orderReference null`, `message null`, `locale`, `status default 'new'` (check `SITE_REQUEST_STATUSES`), `emailSentAt null`, `ipHash null`, `createdAt`, `handledAt null`.
  - `sales` suma `replayCodes text null`, `replayCodesSentAt timestamptz null`. `portalAccounts` suma `providerHandle text null`.
- Produces (`policy.ts`): `PAYMENT_PROVIDERS = ["mercadopago"]`; `ORDER_STATUSES = ["created","pending","approved","rejected","cancelled","refunded","charged_back"]`; `PRO_APPLICATION_STATUSES = ["new","talking","accepted","rejected"]`; `SITE_REQUEST_KINDS = ["withdrawal","cancellation","contact"]`; `SITE_REQUEST_STATUSES = ["new","handled"]`; `ORDER_TTL_MS`, `REPLAY_DELIVERY_HOURS: { vodRecorded: 72, tournamentReview: 96 }`, `PURCHASE_EXPIRY_DAYS = 150`, `REPLAY_CODES_MAX_LENGTH = 4000`, `PRO_LINK_TTL_MS`, `UNPAID_ORDER_RETENTION_DAYS = 90`, `PUBLIC_RECORD_RETENTION_MONTHS = 24`, `STATEMENT_DESCRIPTOR = "TALLAMI"`.
- Produces (`provider.ts`):
  ```ts
  export type PaymentStatus = "approved" | "pending" | "rejected" | "cancelled" | "refunded" | "partially_refunded" | "in_mediation" | "charged_back";
  export interface ProviderPayment { providerPaymentId: string; orderId: string | null; status: PaymentStatus; amountMinor: number; currency: string; approvedAt: Date | null }
  export interface CheckoutRequest { orderId: string; title: string; amountArsMinor: number; payerEmail: string | null; expiresAt: Date; returnUrl: string }
  export interface PaymentProviderClient {
    readonly id: "mercadopago";
    createCheckout(request: CheckoutRequest): Promise<{ redirectUrl: string }>;
    fetchPayment(paymentId: string): Promise<ProviderPayment | null>;
    findPaymentForOrder(orderId: string): Promise<ProviderPayment | null>;
  }
  ```
- Produces (`mercadopago.ts`): `isMercadoPagoConfigured(): boolean`; `getMercadoPagoClient(fetchWith?: typeof fetch): PaymentProviderClient | null`; `verifyWebhookSignature(input: { xSignature: string | null; xRequestId: string | null; dataId: string | null; secret: string }): boolean`.
- Produces (`accounts.ts`): `ProviderIdentity` y `PortalAccount` suman `handle: string | null`.

- [ ] **Step 1: Tests que fallan del cliente, con `fetch` falso.** `createCheckout` hace `POST {base}/checkout/preferences` con `Authorization: Bearer <token>` y este cuerpo exacto para $45.000:
  ```ts
  {
    items: [{ id: orderId, title, quantity: 1, unit_price: 45000, currency_id: "ARS" }],
    external_reference: orderId,
    back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
    auto_return: "approved",
    statement_descriptor: "TALLAMI",
    payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 },
    expires: true,
    expiration_date_to: expiresAt.toISOString(),
    payer: { email },            // solo si hay email
  }
  ```
  y devuelve `init_point` como `redirectUrl`. `fetchPayment` hace `GET {base}/v1/payments/{id}` y normaliza: `approved` + `accredited` → `approved`; `approved` + `partially_refunded` → `partially_refunded`; `in_process`, `authorized`, `pending` → `pending`; `rejected`, `cancelled`, `refunded`, `in_mediation`, `charged_back` iguales; `transaction_amount: 45000` → `amountMinor: 4_500_000`; 404 → `null`; 500 o red caída → tira. `findPaymentForOrder` usa `GET {base}/v1/payments/search?external_reference=<id>&sort=date_created&criteria=desc` y devuelve el primero.
- [ ] **Step 2: Tests que fallan de la firma.** Con `createHmac("sha256", secret).update("id:123;request-id:abc;ts:1700;")`, `xSignature: "ts=1700,v1=<hash>"` da `true`. Falso con otro hash, otro `dataId`, otro secreto, encabezado sin `ts` o sin `v1`, `null`, y un hash de otro largo (sin tirar). Un `dataId` alfanumérico se compara en minúsculas. Compara con `timingSafeEqual`.
- [ ] **Step 3: Tests que fallan del usuario de Discord.** `profileToIdentity("discord", { id, username: "lewa_fn", global_name: "Lewa", verified: false, email: "x" })` da `handle: "lewa_fn"`, `displayName: "Lewa"`, `email: null`; Google da `handle: null`. `upsertAccountFromIdentity` guarda y actualiza el usuario. `db-rls.test.ts` sigue pasando con las tablas nuevas.
- [ ] **Step 4:** correrlos → FALLAN.
- [ ] **Step 5: Implementar** schema, `policy.ts`, `provider.ts`, `mercadopago.ts`, el usuario de Discord y `.env.example`. `npm run db:generate -- --name payments_mercadopago`. Base: `https://api.mercadopago.com`, o `MERCADOPAGO_API_BASE` fuera de Vercel. `fetch` directo con `cache: "no-store"`, `redirect: "error"` y un límite de 10 segundos.
- [ ] **Step 6:** `npx vitest run tests/unit/payments-mercadopago.test.ts tests/unit/portal-accounts.test.ts tests/unit/db-rls.test.ts tests/unit/db-schema.test.ts` → PASAN. `npx tsc --noEmit` limpio.
- [ ] **Step 7: Commit** `feat: tablas de pagos y cliente de Mercado Pago`.

### Task 3: Del pago a la venta: aplicar, avisar y emails

**Files:**
- Create: `src/payments/apply.ts`, `src/payments/webhook.ts`, `src/payments/emails.ts`, `src/email/send.ts`, `src/app/api/payments/mercadopago/route.ts`
- Modify: `messages/{es,pt,en}.json` (namespace `Emails`), `.env.example`
- Test: `tests/unit/payments-apply.test.ts`, `tests/unit/payments-webhook.test.ts`, `tests/unit/payments-emails.test.ts`

**Interfaces:**
- Consumes: Tarea 2.
- Produces (`src/email/send.ts`): `type PublicEmailSetup = { kind: "ready"; apiKey: string; from: string } | { kind: "missing" } | { kind: "test-sender" }`; `getPublicEmailSetup(): PublicEmailSetup` (lee `RESEND_API_KEY` y `PUBLIC_EMAIL_FROM`; un remitente `@resend.dev` es `test-sender`); `type EmailMessage = { to: string; subject: string; text: string }`; `type EmailTransport = (message: EmailMessage & { from: string }) => Promise<void>`; `sendPublicEmail(message: EmailMessage, deps?: { transport?: EmailTransport }): Promise<boolean>`; `sendTallamiEmail(message: Omit<EmailMessage, "to">, deps?): Promise<boolean>` (destino: `ADMIN_ALERT_EMAIL`). Nunca tiran; `false` si no salió, con el error en el log sin datos personales.
- Produces (`apply.ts`):
  ```ts
  export type ApplyOutcome =
    | { kind: "unknown-order" }
    | { kind: "mismatch"; orderId: string }
    | { kind: "sale-created"; orderId: string; saleId: string; status: "paid" | "refunded" }
    | { kind: "sale-updated"; orderId: string; saleId: string; change: "refunded" | "partial-refund" | "mediation" | "charged-back" }
    | { kind: "order-updated"; orderId: string; status: string }
    | { kind: "no-change"; orderId: string };
  export function applyProviderPayment(db: Db, provider: "mercadopago", payment: ProviderPayment, now?: Date): Promise<ApplyOutcome>;
  ```
- Produces (`emails.ts`): `notifyPaymentOutcome(db: Db, outcome: ApplyOutcome, deps?): Promise<void>`. Textos con `createTranslator` y `messages/*.json` en el idioma del pedido.
- Produces (`webhook.ts`): `handleMercadoPagoWebhook(request: Request, deps: { getDb: () => Promise<Db>; client?: PaymentProviderClient | null; now?: () => Date; schedule?: (task: () => Promise<void>) => void }): Promise<Response>`. La ruta pasa `after` de `next/server` como `schedule`.

- [ ] **Step 1: Tests que fallan de `applyProviderPayment`, con `createTestDb()`.**
  - `approved` con cuenta sin alumno: crea `customers` con `name`, `email`, `discord` igual al usuario de Discord, `country: "AR"`, y vincula la cuenta. La venta queda con `currency: "ARS"`, `amountMinor` y `amountArsMinor` iguales al pago, `arsPerUnit: "1.0000"`, `arsPerUsd` del pedido, `rateSource: "manual"`, `rateQuotedOn` el día del pedido, `amountUsdMinor` del pedido, `paymentMethod: "mercadopago"`, `status: "paid"`, `paidOn` el día de Argentina de `approvedAt` (23:30 del 2 de noviembre en Argentina es `2026-11-02`), `source: "mercadopago"`, `invoiceStatus: "pending"`, `dueAt: null`. El pedido queda `approved`, con `saleId` y `providerPaymentId`.
  - Cuenta ya vinculada: usa ese alumno, no crea otro.
  - Cuenta borrada (`accountId` null): crea el alumno con la copia del pedido.
  - **Dos llamadas seguidas y dos a la vez con el mismo pago: una sola venta** y la segunda da `no-change`.
  - Dos pedidos distintos de la misma cuenta sin vincular a la vez: un solo alumno, dos ventas.
  - `pending` y `rejected`: sin venta, pedido actualizado.
  - Monto o moneda distintos del pedido: `mismatch`, sin venta, pedido sin aprobar. `orderId` null o inexistente, o que no es un UUID: `unknown-order`.
  - Un pago con otro `providerPaymentId` para un pedido ya aprobado: `mismatch`, sin segunda venta.
  - `refunded` con venta `paid` o `delivered`: venta `refunded`. Repetido: `no-change`. Venta ya marcada a mano: el pedido se actualiza y la venta no cambia.
  - `refunded` sin venta (la aprobación nunca llegó): crea una sola venta, ya `refunded`, con `paidOn`.
  - `partially_refunded`: venta sigue `paid`, con una línea nueva en `notes`. `in_mediation`: venta sin cambios, `change: "mediation"`. `charged_back`: venta `refunded`, pedido `charged_back`.
- [ ] **Step 2: Tests que fallan del aviso** (`Request` real, cliente falso).
  - Firma mala: 401 sin consultar nada. Secreto sin configurar: 503.
  - `type: "payment"` en el cuerpo, con `data.id` en la consulta: consulta ese pago, aplica y responde 200.
  - `type: "topic_chargebacks_wh"`: la firma usa `data.id` de la consulta y el pago a consultar es `data.payment_id` del cuerpo.
  - Otro `type`: 200 sin consultar. Cuerpo roto o de más de 64 KB: 400 o 413.
  - `fetchPayment` tira: 500, para que Mercado Pago reintente. `null`: 200.
  - Lo que diga el cuerpo sobre estado o monto se ignora.
  - Los emails se programan con `schedule`, no se esperan.
- [ ] **Step 3: Tests que fallan de los emails** (transporte falso).
  - `sale-created`: a Tallami con quién, qué, pesos, dólares y `{SITE_URL}/admin/ventas/{id}`; al comprador en su idioma con servicio, monto, `TALLAMI`, link al portal y los 10 días.
  - Sin email del comprador: solo a Tallami. `mismatch`, mediación y reembolso parcial: solo a Tallami. `no-change`: ninguno.
  - Un transporte que tira no rompe nada.
  - `getPublicEmailSetup`: sin clave `missing`, `onboarding@resend.dev` `test-sender`, un dominio propio `ready`.
  - Ningún texto al comprador contiene `ADMIN_ALERT_EMAIL`.
- [ ] **Step 4:** correrlos → FALLAN.
- [ ] **Step 5: Implementar.** `applyProviderPayment` corre en una transacción y empieza con `select … for no key update` del pedido; bloquea también la cuenta antes de crear el alumno. Ver el comentario de `createInvite` sobre `no key update`.
- [ ] **Step 6:** `npx vitest run tests/unit/payments-apply.test.ts tests/unit/payments-webhook.test.ts tests/unit/payments-emails.test.ts tests/unit/messages.test.ts` → PASAN.
- [ ] **Step 7: Commit** `feat: los pagos aprobados crean la venta y avisan por email`.

### Task 4: Comprar: la pantalla de confirmación, el pago y la vuelta

**Files:**
- Create: `src/payments/checkout.ts`, `src/payments/availability.ts`, `src/payments/orders.ts`, `src/app/[locale]/comprar/[service]/page.tsx`, `src/app/[locale]/comprar/[service]/actions.ts`, `src/components/checkout/*`, `tests/helpers/mock-mercadopago-server.mjs`, `tests/helpers/checkout-e2e.ts`
- Modify: `src/content/services.ts`, `src/components/home/services-menu.tsx`, `src/portal/oauth/flow.ts`, `src/portal/oauth/endpoints.ts`, `src/components/portal/sign-in-buttons.tsx`, `src/portal/page-state.ts`, `src/components/portal/portal-content.tsx`, `src/components/portal/unlinked-view.tsx`, `src/admin/settings/settings-view.tsx`, `next.config.ts`, `playwright.config.ts`, `tests/helpers/admin-server.ts`, `messages/{es,pt,en}.json` (namespace `Checkout`, `Portal.notices`)
- Test: `tests/unit/payments-checkout.test.ts`, `tests/unit/portal-oauth*.test.ts`, `tests/unit/portal-page-state*.test.ts`, `tests/unit/content.test.ts`, `tests/e2e/checkout.spec.ts`, `tests/e2e/interest.spec.ts`, `tests/e2e/home-paper.spec.ts`

**Interfaces:**
- Consumes: Tareas 1 a 3.
- Produces (`services.ts`): `SERVICE_SLUGS: Record<ServiceId, string>` (`vodRecorded: "vod-3-partidas"`, `tournamentReview: "vod-torneo"`, `vodLive: "vod-en-vivo"`, `gamePlan: "plan-de-juego"`); `PRO_SEASON_SLUG = "temporada-pro"`; `serviceFromSlug(slug: string): ServiceId | null`; `bookingHref(id: ServiceId | "proSeason", locale: Locale): string` (`/{locale}/comprar/{slug}`; Temporada Pro `/{locale}/temporada-pro`, página de la Tarea 6).
- Produces (`availability.ts`): `getPaymentAvailability(db: Db): Promise<{ canPay: boolean; rate: string | null; missing: ("credentials" | "rate" | "sender")[] }>`.
- Produces (`orders.ts`): `type Order = typeof orders.$inferSelect`; `createOrder(db, input: typeof orders.$inferInsert): Promise<Order>`; `orderForAccount(db, orderId: string, accountId: string): Promise<Order | null>`; `cancelOrder(db, orderId: string): Promise<void>`.
- Produces (`checkout.ts`):
  ```ts
  export type CheckoutResult = { kind: "redirect"; url: string } | { kind: "error"; reason: "adult" | "price-changed" | "unavailable" | "link-invalid" | "provider" };
  export function startCheckout(db: Db, client: PaymentProviderClient, input: {
    account: PortalAccount; item: ServiceId | "proSeason"; adultConfirmed: boolean; shownArsMinor: number;
    linkToken: string | null; locale: Locale; returnOrigin: string;
  }, now?: Date): Promise<CheckoutResult>;
  export function reconcileOrder(db: Db, client: PaymentProviderClient, order: Order, paymentIdHint: string | null, now?: Date): Promise<void>;
  ```
- Produces (`flow.ts`): `FlowData` suma `checkout: { slug: string; linkToken: string | null } | null`, validado contra las direcciones conocidas.

- [ ] **Step 1: Servidor falso.** `tests/helpers/mock-mercadopago-server.mjs` en Node puro, como `mock-oauth-server.mjs`, puerto `E2E_PORTS.mercadopago = 3111`:
  - `POST /checkout/preferences` guarda y devuelve `{ id, init_point: "{base}/pay/{id}" }`.
  - `GET /pay/:id`: una página con los botones Aprobar, Rechazar y "Aprobar sin aviso".
  - Al elegir: crea el pago, manda el aviso **firmado** a `{APP_BASE}/api/payments/mercadopago?data.id=…&type=payment` (salvo "sin aviso") y redirige a `back_urls` con `payment_id` y `status`.
  - `GET /v1/payments/:id`, `GET /v1/payments/search`.
  - `POST /test/payments/:id` cambia el estado y avisa.
  - `POST /emails` imita a Resend (`RESEND_BASE_URL`); `GET /test/emails`.
  - `GET /health`.

  `adminServerEnv` suma `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_API_BASE`, `PUBLIC_EMAIL_FROM`, `RESEND_API_KEY: "re_test"` y `RESEND_BASE_URL`, y `ADMIN_ALERT_EMAIL` sigue vacío. Los servidores de datos de ejemplo y de seguridad quedan sin ellas. Actualizar `tests/unit/e2e-server-env.test.ts`.
- [ ] **Step 2: Tests unitarios que fallan de `startCheckout`.**
  - Precio del VOD de 3 partidas a 1500: pedido con `amountUsdMinor: 3000`, `arsPerUsd: "1500.0000"`, `amountArsMinor: 4_500_000`, `expiresAt` a 1 hora, `adultConfirmedAt` guardado.
  - Sin casilla: `adult`, sin pedido.
  - **`shownArsMinor` distinto del actual: `price-changed`, sin pedido.**
  - Sin valor, credenciales o remitente: `unavailable`.
  - El proveedor tira: `provider`, pedido `cancelled`, y nunca propaga.
  - **Dos llamadas: dos pedidos.**
  - `returnUrl` es `{returnOrigin}/{locale}/portal?compra={id}`, con `returnOrigin` igual a `SITE_URL` si `VERCEL` está definida.
- [ ] **Step 3: Tests unitarios que fallan del ingreso y del portal.**
  - La cookie del ingreso lleva `checkout`, solo con un `slug` conocido (los cuatro servicios y `temporada-pro`); `comprar=https://mal.example` lo descarta. El `link` solo viaja si el ingreso empezó en el propio sitio (`startedOnThisSite`), como la invitación. La vuelta redirige con 303 a `/{locale}/comprar/{slug}` y el `link`.
  - `parsePortalQuery` lee `compra` solo si es un UUID, y `payment_id` solo si son dígitos.
  - `portalNotice` da `paymentApproved`, `paymentPending` o `paymentFailed` según el estado del pedido **de esa cuenta**, y nada si el pedido es de otro.
- [ ] **Step 4: e2e que falla** (`tests/e2e/checkout.spec.ts`), con `signIn` de `tests/helpers/portal-e2e.ts`.
  - **Compra completa de cada servicio:** el botón de la portada lleva a la pantalla, entra, marca la casilla, paga, aprueba y vuelve al portal con la compra y el aviso. En el panel la venta tiene pesos y dólares.
  - **Sin sesión:** la pantalla muestra precio y botones de ingreso; al volver del ingreso está en la misma pantalla.
  - **Sin casilla** no sale a Mercado Pago, también con el `required` quitado del HTML.
  - **Valor cambiado:** con la pantalla abierta se cambia el valor en el panel; al pagar vuelve con el precio nuevo y el aviso, sin pedido cobrado.
  - **Sesión vencida con la pantalla abierta:** vuelve a ofrecer el ingreso.
  - **Rechazado:** aviso y se puede reintentar. **Aprobar sin aviso:** al volver, el portal lo consulta y la venta aparece igual, una sola.
  - **`/es/portal?compra=<pedido de otro>`:** sin aviso ni dato. **Direcciones:** `/es/comprar/no-existe` 404.
  - **Sin valor cargado** la pantalla dice que todavía no se puede pagar y ofrece contacto (unitario de `getPaymentAvailability`, porque el servidor e2e comparte el valor).
  - `axe` sin violaciones serias ni críticas.
- [ ] **Step 5:** correrlos → FALLAN.
- [ ] **Step 6: Implementar.**
  - Pantalla como el portal: encabezado y pie estáticos, lo personal en `Suspense` con `connection()`. `noindex` y `Referrer-Policy: same-origin` (extender `PORTAL_PAGE_SOURCE` a `/comprar/:path*`).
  - Muestra servicio, descripción, dólares, pesos, la casilla en un formulario que funciona sin JavaScript (`shownArsMinor` en un campo oculto), enlaces a `/terminos`, `/reembolsos`, `/privacidad`, y la línea "¿No estás en Argentina? Escribime" hacia `/contacto`. Esas páginas llegan en las Tareas 7 y 8.
  - La acción lee la sesión; sin sesión, recarga la pantalla. Con `redirect` sale a Mercado Pago; un error vuelve con `?error=<reason>`.
  - `bookingHref` y `ServicesMenu` pasan `locale`. Actualizar `content.test.ts`, `interest.spec.ts` y `home-paper.spec.ts` (hoy esperan `#services`). El encabezado "Reservar" sigue en `#services`.
  - El portal: una cuenta sin vincular con un pedido sin confirmar no ve "pedile tu invitación". `UnlinkedView` suma el link a los servicios.
  - Configuración: una línea de estado de pagos que dice qué falta (`missing`), sin valores.
- [ ] **Step 7:** `npx vitest run` y `npx playwright test tests/e2e/checkout.spec.ts tests/e2e/interest.spec.ts tests/e2e/home-paper.spec.ts tests/e2e/portal-auth.spec.ts tests/e2e/portal-page.spec.ts` → PASAN.
- [ ] **Step 8: Commit** `feat: comprar un servicio con Mercado Pago desde la web`.

### Task 5: Códigos de replay y lo pendiente en el panel

**Files:**
- Create: `src/payments/replay-codes.ts`, `src/components/portal/replay-codes-form.tsx`, `src/app/[locale]/portal/actions.ts`
- Modify: `src/portal/purchases.ts`, `src/components/portal/purchase-card.tsx`, `src/admin/metrics/metric-sale.ts`, `src/admin/metrics/load.ts`, `src/admin/metrics/pending.ts`, `src/admin/overview/pending-section.tsx`, `src/admin/sales/sale-row.ts`, `src/app/admin/ventas/[id]/page.tsx`, `src/payments/emails.ts`, `messages/{es,pt,en}.json` (`Portal.replay`, `Emails`)
- Test: `tests/unit/payments-replay-codes.test.ts`, `tests/unit/metrics-pending.test.ts`, `tests/unit/portal-purchases*.test.ts`, `tests/e2e/checkout-replay.spec.ts`

**Interfaces:**
- Consumes: Tarea 3 (`sendTallamiEmail`), Tarea 2 (`REPLAY_DELIVERY_HOURS`, `PURCHASE_EXPIRY_DAYS`, `REPLAY_CODES_MAX_LENGTH`).
- Produces (`replay-codes.ts`): `submitReplayCodes(db: Db, input: { customerId: string; saleId: string; codes: string }, now?: Date): Promise<"saved" | "corrected" | "not-found" | "closed" | "invalid">`; `replayState(sale, deliveryCount: number, now: Date): StudentReplayCodes`.
- Produces (`purchases.ts`): `StudentPurchase` suma `replay: StudentReplayCodes`, con `type StudentReplayCodes = { state: "none" } | { state: "open" } | { state: "sent"; codes: string; dueAt: string; editable: boolean } | { state: "expired" }`.
- Produces (`pending.ts`): `PendingDelivery` suma `waitingForCodes: boolean`; `PendingWork` suma `toCoordinate: PendingSaleRef[]`. `MetricSale` suma `replayCodesSentAt: string | null`.

- [ ] **Step 1: Tests que fallan.**
  - Primer envío en un VOD de 3 partidas: `saved`, guarda el texto recortado y la hora, `dueAt` a +72 h; en torneo completo a +96 h. Corregir: `corrected`, `dueAt` y `replayCodesSentAt` iguales.
  - Con una entrega cargada: `closed`. Otro servicio, una venta de otro alumno o un id que no es UUID: `not-found`. Estado que no es `paid`: `closed`.
  - Vacío o solo espacios, o 4001 caracteres: `invalid`.
  - A los 150 días justos de `paidOn` sin códigos: `closed` y `replayState` da `expired`; a los 149 días: `open`.
  - Dos primeros envíos a la vez: un solo `dueAt`.
  - `pendingWork`: `paid` de VOD en vivo y Temporada Pro sin `dueAt` van a `toCoordinate`, no a `sessions`; con fecha, no. `tournamentReview` y `vodRecorded` sin códigos: `waitingForCodes: true`; el plan de juego: `false`.
- [ ] **Step 2: e2e que falla.**
  - El alumno compra, pega `ABC-123`, ve hasta cuándo es la entrega, y el panel muestra la venta con fecha en "Entregas por hacer" y los códigos en la ficha.
  - **`<script>alert(1)</script>` se ve como texto en el portal y en el panel.**
  - Otro alumno no puede mandar códigos a esa venta (la acción responde como si no existiera).
  - Una venta de VOD en vivo aparece en "Por coordinar".
- [ ] **Step 3:** correrlos → FALLAN.
- [ ] **Step 4: Implementar.** La primera escritura es un `update … where replay_codes_sent_at is null`. La acción lee la sesión y usa el `customerId` de la cuenta, nunca uno del formulario. En "Entregas por hacer", una venta sin códigos dice "faltan los códigos del alumno". Sumar el bloque "Por coordinar" con `testId="pending-coordinate"`. El email a Tallami sale con el primer envío.
- [ ] **Step 5:** `npx vitest run` y `npx playwright test tests/e2e/checkout-replay.spec.ts tests/e2e/portal-page.spec.ts` y, con los datos de ejemplo, `npx playwright test -c playwright.demo.config.ts tests/e2e/admin-overview.spec.ts` → PASAN.
- [ ] **Step 6: Commit** `feat: códigos de replay en el portal y ventas por coordinar en el panel`.

### Task 6: Temporada Pro

**Files:**
- Create: `src/pro/applications.ts`, `src/pro/payment-links.ts`, `src/public-forms/guard.ts`, `src/app/[locale]/temporada-pro/page.tsx`, `src/app/[locale]/temporada-pro/actions.ts`, `src/components/pro/application-form.tsx`, `src/app/admin/aplicaciones/page.tsx`, `src/app/admin/aplicaciones/[id]/page.tsx`, `src/app/admin/aplicaciones/actions.ts`
- Modify: `src/payments/checkout.ts`, `src/payments/apply.ts`, `src/app/[locale]/comprar/[service]/page.tsx`, `src/admin/routes.ts`, `src/admin/ui/admin-shell.tsx` (navegación), `src/payments/emails.ts`, `messages/{es,pt,en}.json` (`Pro`, `Checkout`)
- Test: `tests/unit/pro-applications.test.ts`, `tests/unit/pro-payment-links.test.ts`, `tests/e2e/pro-season.spec.ts`

**Interfaces:**
- Consumes: Tarea 4 (`startCheckout`, `linkToken`).
- Produces (`public-forms/guard.ts`): `PUBLIC_FORM_MAX_PER_HOUR = 5`; `PUBLIC_FORM_GLOBAL_MAX_PER_HOUR = 100`; `publicFormIpHash(headers: Headers, now: Date): string | null`; `isOverPublicFormLimit(db: Db, table: "proApplications" | "siteRequests", ipHash: string | null, now: Date): Promise<boolean>`; `isHoneypotFilled(formData: FormData): boolean` (campo `website`).
- Produces (`applications.ts`): `submitProApplication(db, input, context, now?): Promise<{ ok: true } | { ok: false; fieldErrors: Record<string, string> } | { ok: false; limited: true }>`; `listProApplications(db)`; `getProApplication(db, id)`; `setProApplicationStatus(db, id, status)`; `deleteProApplication(db, id)`.
- Produces (`payment-links.ts`): `createProPaymentLink(db, applicationId: string, amountUsdMinor: number, now?: Date): Promise<string>` (token en claro, 32 bytes base64url, en la base su SHA-256); `readProPaymentLink(db, token: string, now?: Date): Promise<{ id: string; amountUsdMinor: number } | null>`; `proPaymentLinkUrl(token: string, locale: Locale): string`; `markProPaymentLinkPaid(tx, id, now)`.

- [ ] **Step 1: Tests que fallan.**
  - Aplicación válida se guarda y avisa a Tallami. Faltan nombre, Discord, integrantes, resultados o la casilla de privacidad: errores por campo.
  - Campos de más de 200 caracteres (nombre, Discord), 2000 (integrantes, resultados, mensaje): rechazados.
  - Campo trampa lleno: responde como si hubiera salido bien y no guarda.
  - Sexta aplicación de la misma conexión en una hora, o la número 101 del sitio: `limited`.
  - Link: en la base nunca el token en claro; a los 14 días justos `null`, a los 13 días vale; pagado `null`. Monto cero o no entero: rechazado.
  - **Varios links en una aplicación conviven.** Un pedido aprobado marca solo su link y crea una venta `proSeason` por el monto del link.
  - `startCheckout` con `item: "proSeason"` sin link o con uno usado: `link-invalid`.
  - Borrar una aplicación no borra las ventas.
- [ ] **Step 2: e2e que falla.**
  - Visitante aplica sin entrar, ve la confirmación; Tallami ve la aplicación, cambia su estado, genera dos links de USD 1.000 y USD 1.500.
  - Un alumno abre el primero, entra, ve USD 1.000 y sus pesos, y paga; la ficha muestra ese link pagado y USD 1.000 cobrados, y el estado no cambió solo. El segundo link sigue funcionando con otro alumno.
  - **El primer link abierto de nuevo dice que ya se usó, sin dato de la venta.**
  - **`<script>` en el mensaje se ve como texto en el panel.**
  - `/es/comprar/temporada-pro` sin link lleva a aplicar.
- [ ] **Step 3:** correrlos → FALLAN.
- [ ] **Step 4: Implementar.** El formulario va con `useActionState` y funciona sin JavaScript. La página es estática salvo el formulario. `ADMIN_ROUTES` suma `applications: "/admin/aplicaciones"` y `applicationHref(id)`. La ficha muestra datos, estado, links (monto, vence, pagado o no), total cobrado, generar link (dólares, 2.500 por defecto) y borrar. El token solo se muestra al crearlo, como las invitaciones.
- [ ] **Step 5:** `npx vitest run` y `npx playwright test tests/e2e/pro-season.spec.ts` → PASAN, `tests/unit/admin-guards.test.ts` incluido.
- [ ] **Step 6: Commit** `feat: Temporada Pro por aplicación y link de pago`.

### Task 7: Arrepentimiento, baja, contacto y limpieza

**Files:**
- Create: `src/site-requests/requests.ts`, `src/payments/retention.ts`, `src/app/[locale]/arrepentimiento/page.tsx`, `src/app/[locale]/baja/page.tsx`, `src/app/[locale]/contacto/page.tsx`, `src/app/[locale]/(forms)/actions.ts`, `src/components/site-requests/request-form.tsx`, `src/app/admin/pedidos/page.tsx`, `src/app/admin/pedidos/actions.ts`
- Modify: `src/components/home/site-footer.tsx`, `src/portal/oauth/endpoints.ts`, `src/admin/routes.ts`, `src/admin/ui/admin-shell.tsx`, `messages/{es,pt,en}.json` (`SiteRequests`, `Footer`, `Emails`)
- Test: `tests/unit/site-requests.test.ts`, `tests/unit/payments-retention.test.ts`, `tests/e2e/site-requests.spec.ts`

**Interfaces:**
- Consumes: Tarea 6 (`public-forms/guard.ts`), Tarea 3 (`sendPublicEmail`, `sendTallamiEmail`).
- Produces (`requests.ts`): `submitSiteRequest(db, kind: SiteRequestKind, input, context, deps?, now?): Promise<{ ok: true; code: string } | { ok: false; fieldErrors: Record<string, string> } | { ok: false; limited: true }>`; `listSiteRequests(db)`; `markSiteRequestHandled(db, id, now?)`; `deleteSiteRequest(db, id)`.
- Produces (`retention.ts`): `purgeExpiredRecords(db: Db, now?: Date): Promise<void>`.

- [ ] **Step 1: Tests que fallan.**
  - Los tres tipos guardan y devuelven un código con prefijo `ARR-`, `BAJ-` o `CON-` y 6 caracteres sin ambiguos. Dos pedidos, dos códigos.
  - Arrepentimiento y baja mandan al solicitante un email en su idioma con ese código, y a Tallami un aviso. Contacto solo a Tallami. `emailSentAt` queda con la hora si salió y en `null` si el transporte falló, y **el código se devuelve igual**.
  - Falta nombre o email, o email inválido: errores por campo. Contacto exige mensaje; arrepentimiento y baja no.
  - Mensaje de 2001 caracteres: rechazado. Campo trampa: como si saliera bien, sin guardar. Sexta de la misma conexión en una hora: `limited`.
  - `purgeExpiredRecords`: borra un pedido `created`, `rejected` o `cancelled` de 91 días y deja el de 89 días; **nunca** uno `approved`, `refunded` o `charged_back`; borra aplicaciones y pedidos del sitio de más de 24 meses; un link pagado se va con su aplicación, y la venta queda.
- [ ] **Step 2: e2e que falla.**
  - **El pie de `/es`, `/pt` y `/en` tiene los enlaces con el texto exacto "BOTÓN DE ARREPENTIMIENTO" y "BOTÓN DE BAJA DE SERVICIO", sin entrar con cuenta.**
  - Mandar arrepentimiento muestra el código en pantalla y el email aparece en el servidor falso (`GET /test/emails`). El panel lo lista como nuevo, con el email salido; marcarlo atendido y borrarlo funciona.
  - Contacto muestra el horario "lunes a viernes, de 10 a 18".
  - `<script>` en el mensaje se ve como texto en el panel.
  - El pie no contiene ningún email (regex de dirección sobre el texto de la página).
- [ ] **Step 3:** correrlos → FALLAN.
- [ ] **Step 4: Implementar.** Un componente de formulario para los tres. Páginas estáticas con `noindex`. Los dos botones van en el pie con ese texto en los tres idiomas: la norma los nombra así; lo demás de la página sí se traduce. `purgeExpiredRecords` se llama junto a `purgePortalRecords` en `src/portal/oauth/endpoints.ts`, de pasada: si falla, el ingreso sigue. `ADMIN_ROUTES` suma `siteRequests: "/admin/pedidos"`.
- [ ] **Step 5:** `npx vitest run` y `npx playwright test tests/e2e/site-requests.spec.ts tests/e2e/quality.spec.ts` → PASAN.
- [ ] **Step 6: Commit** `feat: botones de arrepentimiento y baja, contacto y limpieza de datos`.

### Task 8: Páginas legales, textos del sitio y guía

**Files:**
- Create: `src/content/legal/types.ts`, `src/content/legal/terms.ts`, `src/content/legal/refunds.ts`, `src/content/legal/privacy.ts`, `src/components/legal/legal-page.tsx`, `src/app/[locale]/terminos/page.tsx`, `src/app/[locale]/reembolsos/page.tsx`, `src/app/[locale]/privacidad/page.tsx`
- Modify: `src/components/home/site-footer.tsx`, `src/components/home/faq.tsx`, `src/app/sitemap.ts`, `messages/{es,pt,en}.json` (`Faq`, `Services.payments`, `HowItWorks`, `Footer`), `README.md`, `CLAUDE.md`, `tests/e2e/home-paper.spec.ts`, `tests/unit/messages.test.ts`
- Test: `tests/unit/legal-content.test.ts`, `tests/e2e/legal-pages.spec.ts`

**Interfaces:**
- Produces (`types.ts`): `type LegalDocument = { title: string; description: string; updatedOn: string; sections: { heading: string; paragraphs: string[] }[] }`. Cada archivo exporta `Record<Locale, LegalDocument>`.

- [ ] **Step 1: Tests que fallan** (`legal-content.test.ts`, sobre los tres documentos en los tres idiomas, y `messages/*.json`).
  - No hay ningún email (regex de dirección), CUIT (`\b\d{2}-?\d{8}-?\d\b`) ni dirección de Tallami.
  - Nada dice "sin reembolso", "no hay reembolsos", "no refunds", "sem reembolso" ni "todas las ventas son finales".
  - Términos en español nombra a Tomás Allami, los 10 días, los 13 años, los 150 días, 24 horas y 15 minutos, 72 y 96 horas, Mercado Pago, y "No afiliado" con Epic Games.
  - Privacidad nombra Vercel, Supabase, Resend, Mercado Pago, Discord, Google, YouTube, jsDelivr y la AAIP; y 90 días y 24 meses.
  - Los tres idiomas tienen las mismas secciones.
- [ ] **Step 2: e2e que falla.**
  - Las tres páginas responden 200 en los tres idiomas, con enlace en el pie y en la pantalla de confirmación.
  - Tienen título propio y aparecen en el sitemap. `axe` sin violaciones serias ni críticas.
  - Las preguntas frecuentes de `/es` son las 13 de abajo.
  - `/es` no contiene "Pix", "PayPal", "cripto", "rol en Discord" ni "link que te llega".
- [ ] **Step 3:** correrlos → FALLAN.
- [ ] **Step 4: Redactar lo legal** en español y traducir a pt y en, con las reglas del spec. Cada página dice su fecha. Es un borrador para el abogado: frases claras, sin inventar datos.
  - **Términos**, estas 14 cláusulas: quién vende (Tomás Allami, "Tallami"); qué se vende (cada servicio, qué incluye, duración y plazo); quién puede comprar (paga un adulto, jugadores desde 13 años con su aprobación); cuentas (Discord o Google, una por alumno); precio y pago (referencia en dólares, se cobra en pesos, pagado cuando Mercado Pago confirma, la web no ve datos de tarjeta); entrega (códigos de replay, portal, YouTube no listado o PDF, coordinación por mensaje); uso de lo entregado (uso personal, no compartir ni revender los links); arrepentimiento y reembolsos (remite a `/reembolsos`); reprogramación y ausencias; sin garantía de resultados (no promete puesto ni premios, los resultados son de esos jugadores); reglas del juego (el alumno cumple las reglas de Epic, sin trampas ni cuentas compartidas, Tallami puede terminar el servicio y devolver lo no usado); Temporada Pro (aplicación, sin garantía de aceptación, cada acuerdo fija montos y reembolsos); responsabilidad y cambios (hasta donde permite la ley de consumo, las versiones nuevas valen para compras futuras); ley y reclamos (ley argentina sin quitar derechos del consumidor, primero el contacto, después la Ventanilla Federal de Reclamos).
  - **Reembolsos:** la regla de los 10 días, cuándo cuenta como usado cada servicio, reprogramación, ausencias, los 150 días, y que se devuelve por Mercado Pago lo pagado en pesos.
  - **Privacidad:** quién es responsable; qué se guarda y para qué (cuenta de Discord o Google, ficha de alumno, compras, entregas, códigos de replay, clics anónimos 400 días, cookies de sesión 30 días, resultado del pago y nunca datos de tarjeta, confirmación de adulto, aplicaciones, pedidos del sitio); cuánto (cuentas sin vincular unos 31 días, pedidos sin pagar 90 días, aplicaciones y pedidos del sitio 24 meses, ventas lo que pida la ley); quién lo procesa y qué ve (Vercel y Supabase en San Pablo, Resend, Mercado Pago, Discord, Google, YouTube al tocar play, jsDelivr las imágenes); derechos de acceso, corrección y borrado, por el formulario de contacto; la AAIP como autoridad; datos de menores limitados a lo necesario.
- [ ] **Step 5: Preguntas frecuentes, en este orden y con este texto en español** (traducir a pt y en; `FAQ_ITEMS` y `messages` cambian):
  1. ¿Cómo compro? — Elegís el servicio y entrás con Discord o Google. Confirmás el precio y pagás en Mercado Pago. Tu compra aparece en el Portal de alumnos cuando se confirma el pago.
  2. ¿Qué pasa después de pagar? — Te escribo para coordinar. Todo lo que te entrego queda guardado en tu portal.
  3. ¿Cómo pago desde mi país? — Por ahora se paga con Mercado Pago, desde Argentina. Si estás en otro país, escribime y vemos cómo hacerlo.
  4. ¿Por qué veo dólares y pesos? — El precio se fija en dólares. En Argentina pagás en pesos y ves el monto exacto antes de confirmar.
  5. ¿Puedo entrenar si tengo menos de 18 años? — Sí, desde los 13. El pago lo hace un adulto responsable, y la sesión es con vos.
  6. ¿Cómo agendo la sesión? — Coordinamos día y hora por mensaje. Para hablar en vivo te paso mi Discord.
  7. ¿Qué te mando para un VOD review? — Si es offline, pegás los códigos de replay en tu compra, en el portal, y veo las partidas en el juego. Si es en vivo, las vemos juntos en la sesión.
  8. ¿Cuándo recibo mi VOD review? — El de 3 partidas, en 72 horas desde que me pasás los códigos. El de torneo completo, en 96 horas. El video queda en tu portal.
  9. ¿Y si no puedo ir a la sesión? — Avisame con 24 horas y la cambiamos sin costo. Si no avisás y pasan 15 minutos del inicio, la sesión cuenta como usada. Si el que falta soy yo, elegís otra fecha o te devuelvo todo.
  10. ¿Me puedo arrepentir de la compra? — Sí. Tenés 10 días desde la compra para pedir el reembolso, salvo que ya te haya entregado el servicio. Usá el Botón de arrepentimiento, al pie de la página. Te devuelvo por Mercado Pago lo que pagaste en pesos.
  11. ¿Me garantizás resultados? — No. Te doy análisis y un plan de trabajo, pero el resultado depende de tu juego y de cada torneo. Los resultados de esta web son de jugadores con los que trabajé.
  12. ¿Cómo entro a la Temporada Pro? — Mandás una aplicación corta y hablamos. Si encajamos, te paso un link de pago.
  13. ¿Cómo te contacto? — Desde el formulario de contacto, de lunes a viernes de 10 a 18, hora de Argentina.
- [ ] **Step 6: Otros textos en español** (y traducidos):
  - `Services.payments`: "Precios en dólares y en pesos. Por ahora se paga con Mercado Pago, desde Argentina. ¿Estás en otro país? Escribime."
  - `HowItWorks.steps.pay.body`: "Con Mercado Pago, en pesos. Te llega la confirmación por email."
  - `HowItWorks.steps.schedule.title`: "Coordinamos". Su `body`: "Si es un VOD offline, pegás tus códigos de replay en el portal. Si es en vivo, arreglamos día y hora."
  - Actualizar `tests/e2e/home-paper.spec.ts` y `tests/unit/messages.test.ts`.
- [ ] **Step 7: README y CLAUDE.md.**
  - README, sección "Pagos": crear la aplicación en Mercado Pago, credenciales de prueba y de producción, aviso en "Tus integraciones" con los eventos Pagos y Contestações/Contracargos y su clave secreta, verificar el dominio en Resend y `PUBLIC_EMAIL_FROM`, cargar pesos por dólar, probar con usuarios de prueba (Mercado Pago no acepta `auto_return` con `localhost`: usar la dirección publicada o un túnel), `npm run db:migrate` antes de desplegar (0008), arreglar un alumno duplicado (pasar la venta al alumno original, desvincular y borrar el duplicado, invitar a la cuenta), y qué falta antes de cobrar: abogado, contador (QR de ARCA, "precio sin impuestos nacionales", factura a quien paga), cuenta. Actualizar "Portal del alumno" con los códigos y lo que se vincula solo.
  - `CLAUDE.md`, párrafo "Pagos": sacar rol en Discord y link para agendar.
- [ ] **Step 8:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` y `npm run test:e2e` → PASAN los tres servidores.
- [ ] **Step 9: Commit** `feat: páginas legales, textos del sitio y guía de pagos`.
