# Portal del alumno — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada alumno entre con Discord o Google a `/[locale]/portal` y vea sus compras y las entregas que Tallami le carga desde el panel (YouTube no listado, PDF hasta 4 MB o link).

**Architecture:** Cuentas de alumno propias (no Supabase Auth): OAuth 2.0 *authorization code* + PKCE + `state` contra Discord o Google, sesiones opacas en la base (cookie `tallami_alumno`, token guardado como hash). Las cuentas se vinculan a un alumno del panel (`customers`) con una invitación de un solo uso que genera Tallami. Las entregas cuelgan de las ventas; los PDF se guardan en la base detrás de una interfaz de almacenamiento. En tests, un proveedor OAuth falso local reemplaza a Discord/Google.

**Tech Stack:** Next.js 16.4.3 (App Router, next-intl, Server Actions, route handlers), TypeScript, Drizzle 0.45 + PGlite/postgres.js, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-student-portal-design.md` (leerlo entero antes de cada tarea).

## Global Constraints

- Rama `feat/student-portal`. Commits por tarea o grupo, mensajes convencionales en español, staging por ruta explícita (nunca `git add -A`), cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Valores (en `src/portal/policy.ts`, una sola vez): sesión del alumno **30 días**; flujo OAuth (cookie de `state`/PKCE) **10 minutos**, un solo uso; invitación **14 días**, un solo uso, guardada como hash; PDF **4 MB** como máximo y empieza con `%PDF-`; título de una entrega 1–120 caracteres; link solo `https://`.
- Cookie de sesión `tallami_alumno`: `httpOnly`, `SameSite=Lax`, `path=/`, `Secure` salvo http en `localhost`, 30 días. Cookie del flujo OAuth `tallami_alumno_oauth`: `httpOnly`, `SameSite=Lax`, `path=/api/portal/auth`, 10 minutos. Secreto `PORTAL_SESSION_SECRET` (≥ 32 caracteres), separado de `ADMIN_SESSION_SECRET`. La sesión del alumno nunca sirve en `/admin` ni la del panel en el portal.
- Scopes: Discord `identify email`; Google `openid email profile`. Se guarda: proveedor, id del usuario, nombre para mostrar, email solo si está verificado. Los tokens del proveedor se descartan.
- Redirecciones: después de entrar solo se vuelve a `/{es|pt|en}/portal` (sin redirección abierta).
- Proveedor de prueba: `PORTAL_OAUTH_TEST_ISSUER` (ignorada cuando `VERCEL_ENV === "production"`) habilita el proveedor `test` que habla con el servidor OAuth falso de los tests.
- El portal nunca muestra datos internos del panel: notas, factura, montos en pesos/dólares calculados, cotizaciones, fuente, medio de pago, datos de otros alumnos. Lo que sale del servidor hacia el portal pasa por un tipo de datos propio (DTO) con campos explícitos.
- Panel: `requireAdmin()` primero en toda página/acción/ruta nueva bajo `src/app/admin` (lo hace cumplir `tests/unit/admin-guards.test.ts`). Portal: cada página/acción/ruta lee la sesión del alumno y verifica el dueño antes de devolver nada.
- Tablas nuevas con `.enableRLS()`, migración con `npm run db:generate`; correr `npm run db:migrate` antes de desplegar (README).
- Sitio público: `/es` `/pt` `/en` siguen ○ estáticas; el portal es dinámico. UI del portal en es/pt/en (`messages/*.json`, namespace `Portal`), voseo en español; el panel sigue solo en español.
- Tests sin red. `DATABASE_URL` vacía en todo lo que se corra. Write/Edit (escapes `\u`, nunca NUL ni BOM literal), no heredocs. Servidores por PID; nunca `taskkill /IM node.exe`; el puerto 3000 es de Tallami; nunca leer, imprimir ni cambiar `.env.local`.
- Documentación por context7 (`/vercel/next.js/v16.2.9`, `/pilcrowonpaper/arctic` si se usa, Discord y Google OAuth en sus docs oficiales), no de memoria.

## Review Focus

1. **Un alumno intenta ver lo de otro** (cambiar el id de un PDF o de una entrega en la URL, abrir el link de invitación de otro ya usado): 404 sin pista; nunca un dato ajeno. Tests en las Tareas 4 y 5.
2. **El ingreso vuelve con `state` distinto, sin cookie, repetido o vencido** (pestaña vieja, botón atrás, otra pestaña que empezó otro ingreso): vuelve al portal con "No pudimos completar el ingreso, probá de nuevo" y no crea sesión. Test en la Tarea 2.
3. **Discord o Google responden con error o el alumno cancela** (`?error=access_denied`): mismo mensaje amable, sin 500. Test en la Tarea 2.
4. **Invitación a un alumno que ya tiene cuenta, o cuenta que ya está vinculada a otro alumno**: no se pisa nada; mensaje claro. Test en la Tarea 3.
5. **PDF falso o grande** (un `.exe` renombrado, 5 MB): rechazado con mensaje en el panel, sin guardar nada. Test en la Tarea 4.

---

### Task 1: Tablas, configuración y sesiones del alumno

**Files:**
- Create: `src/portal/policy.ts`, `src/portal/config.ts`, `src/portal/sessions.ts`, `src/portal/accounts.ts`, `drizzle/0006_*.sql` (generada)
- Modify: `src/db/schema.ts`, `.env.example`
- Test: `tests/unit/portal-sessions.test.ts`, `tests/unit/portal-accounts.test.ts`, `tests/unit/portal-config.test.ts`, `tests/unit/db-rls.test.ts`

**Interfaces:**
- Produces (schema):
  - `portalAccounts` (`portal_accounts`): `id uuid pk`, `provider text not null` (check `discord|google|test`), `providerUserId text not null`, `displayName text not null`, `email text null`, `customerId uuid null unique → customers.id on delete set null`, `createdAt`, `lastLoginAt`; unique (`provider`, `providerUserId`).
  - `portalSessions` (`portal_sessions`): `id text pk` (SHA-256 hex del token), `accountId uuid not null → portal_accounts.id on delete cascade`, `createdAt`, `expiresAt`, `revokedAt null`.
  - `portalInvites` (`portal_invites`): `id uuid pk`, `tokenHash text not null unique`, `customerId uuid not null → customers.id on delete cascade`, `createdAt`, `expiresAt`, `usedAt null`, `usedByAccountId uuid null → portal_accounts.id on delete set null`.
  - `deliveries` (`deliveries`): `id uuid pk`, `saleId uuid not null → sales.id on delete cascade`, `kind text not null` (check `youtube|pdf|link`), `title text not null` (check 1–120), `youtubeVideoId text null`, `url text null`, `fileId uuid null → delivery_files.id on delete cascade`, `createdAt`; check: exactamente el campo de su tipo.
  - `deliveryFiles` (`delivery_files`): `id uuid pk`, `contentType text not null`, `size integer not null`, `bytes bytea not null` (customType de Drizzle), `createdAt`.
  - Índices en todas las claves foráneas.
- Produces (`policy.ts`): `PORTAL_SESSION_MS`, `PORTAL_OAUTH_FLOW_MS`, `PORTAL_INVITE_MS`, `DELIVERY_PDF_MAX_BYTES` (4 * 1024 * 1024), `DELIVERY_TITLE_MAX_LENGTH` (120).
- Produces (`config.ts`): `type PortalProvider = "discord" | "google" | "test"`; `getPortalSecret(): Uint8Array | null`; `enabledProviders(): PortalProvider[]` (un proveedor está si tiene id y secreto; `test` solo con `PORTAL_OAUTH_TEST_ISSUER` y fuera de producción de Vercel); `isPortalConfigured(): boolean` (secreto + al menos un proveedor + base).
- Produces (`sessions.ts`): `PORTAL_COOKIE = "tallami_alumno"`; `portalCookieOptions(secure: boolean)`; `createPortalSession(db, accountId, now?): Promise<string>` (devuelve el token en claro: 32 bytes base64url; guarda el hash); `readPortalSession(db, token: string | undefined, now?): Promise<{ accountId: string } | null>`; `revokePortalSession(db, token, now?)`; `revokeAccountSessions(db, accountId, now?)`.
- Produces (`accounts.ts`): `type PortalAccount = { id; provider; displayName; email: string | null; customerId: string | null }`; `upsertAccountFromIdentity(db, { provider, providerUserId, displayName, email }, now?): Promise<PortalAccount>`; `getAccount(db, id)`; `linkAccountToCustomer(db, accountId, customerId): Promise<"linked" | "account-linked-elsewhere" | "customer-has-account">` (atómico); `unlinkCustomer(db, customerId): Promise<string | null>` (id de la cuenta desvinculada); `deleteAccountOfCustomer(db, customerId)`; `accountForCustomer(db, customerId): Promise<PortalAccount | null>`.
- Helper de servidor: `src/portal/current.ts` — `getCurrentStudent(): Promise<PortalAccount | null>` (lee la cookie con `cookies()`, valida en la base; envuelto en `cache()`).

- [ ] **Step 1: Tests que fallan.** Sesiones: el token no está en la base en claro; válida a los 29 días 23:59, `null` a los 30 días; revocada → `null`; `revokeAccountSessions` cierra todas las de la cuenta. Cuentas: la misma identidad dos veces → la misma cuenta (actualiza nombre/email/último ingreso); `linkAccountToCustomer` dos cuentas al mismo alumno en paralelo → una sola gana, la otra `"customer-has-account"`; cuenta ya vinculada a otro alumno → `"account-linked-elsewhere"`; borrar el alumno del panel deja la cuenta sin vínculo. Config: `test` ignorado con `VERCEL_ENV=production`; proveedor sin secreto no aparece. RLS: las cinco tablas nuevas.
- [ ] **Step 2:** correrlos → FALLAN. **Step 3:** implementar + `npm run db:generate` (una migración, renombrarla `0006_student_portal.sql` y su entrada del journal si drizzle le da un nombre al azar). **Step 4:** PASAN; `npm run lint && npm run typecheck && npm run test`.
- [ ] **Step 5: Commit** `feat: tablas y sesiones de las cuentas de alumno`.

### Task 2: Ingreso con Discord y Google

**Files:**
- Create: `src/portal/oauth/providers.ts`, `src/portal/oauth/flow.ts`, `src/app/api/portal/auth/[provider]/route.ts`, `src/app/api/portal/auth/[provider]/callback/route.ts`, `src/app/api/portal/auth/logout/route.ts`, `tests/helpers/mock-oauth-server.mjs`, `tests/e2e/portal-auth.spec.ts`
- Modify: `playwright.config.ts` (segundo `webServer`: el servidor OAuth falso en el puerto 3110; `PORTAL_OAUTH_TEST_ISSUER=http://localhost:3110`, `PORTAL_SESSION_SECRET` de prueba en el servidor principal), `tests/helpers/admin-server.ts`
- Test: `tests/unit/portal-oauth-flow.test.ts`, `tests/unit/portal-oauth-providers.test.ts`

**Interfaces:**
- Produces (`providers.ts`): `type ProviderIdentity = { providerUserId: string; displayName: string; email: string | null }`; por proveedor: URL de autorización, de token y de perfil, scopes, y `profileToIdentity(json): ProviderIdentity | null` (Discord: `id`, `global_name ?? username`, `email` solo si `verified`; Google: `sub`, `name`, `email` solo si `email_verified`; test: `sub`, `name`, `email`). URL de vuelta: `${SITE_URL}/api/portal/auth/{provider}/callback` (o el origen del proveedor de prueba en tests).
- Produces (`flow.ts`): `startFlow({ provider, locale, inviteToken? }): { authorizationUrl: string; cookieValue: string }` (genera `state` y `codeVerifier` aleatorios; la cookie lleva `{ provider, state, codeVerifier, locale, inviteToken, expiresAt }` firmado con HMAC de `PORTAL_SESSION_SECRET`); `readFlowCookie(raw): FlowData | null` (firma, vencimiento, proveedor); `exchangeAndFetchIdentity(provider, code, codeVerifier): Promise<ProviderIdentity | null>` (nunca tira; `fetch` inyectable para tests).
- Rutas:
  - `GET /api/portal/auth/[provider]?locale=es&invitacion=…` → 404 si el proveedor no está habilitado; si no, cookie del flujo y 302 a la autorización. `locale` inválido → `es`.
  - `GET /api/portal/auth/[provider]/callback?code&state` (o `?error=…`) → valida cookie + `state` + proveedor (comparación en tiempo constante), borra la cookie del flujo **siempre**, intercambia el código, `upsertAccountFromIdentity`, si hay invitación la canjea (Tarea 3 agrega `redeemInvite`; acá dejá el punto de enganche con un test pendiente marcado `todo` que la Tarea 3 completa), crea la sesión, cookie `tallami_alumno`, 303 a `/{locale}/portal`. Cualquier falla → 303 a `/{locale}/portal?ingreso=fallido` sin sesión.
  - `POST /api/portal/auth/logout` → revoca la sesión, borra la cookie, 303 a `/{locale}/portal`. Solo POST (un GET no cierra nada).
- `tests/helpers/mock-oauth-server.mjs`: servidor HTTP mínimo (sin dependencias) con `/authorize` (redirige enseguida al `redirect_uri` con `code` y el `state` recibido; el usuario se elige con `login_hint` o, en los tests de navegador, con la cookie `mock_oauth_student` de cada contexto (sin usuario por defecto; ver `tests/helpers/portal-e2e.ts`); `?deny=1` devuelve `error=access_denied`), `/token` (verifica `code_verifier` contra el `code_challenge` S256 guardado) y `/userinfo`.

- [ ] **Step 1: Tests que fallan.** Unit: `startFlow` genera `state` y verificador distintos cada vez y el `code_challenge` S256 correcto; `readFlowCookie` rechaza firma alterada, vencida (10 min) y otro proveedor; `profileToIdentity` de cada proveedor (email no verificado → `null`); `exchangeAndFetchIdentity` con `fetch` falso que devuelve 400/500/JSON roto → `null`. E2e (`portal-auth.spec.ts`, proveedor `test`): entrar → `/es/portal` con la cookie `tallami_alumno` (`httpOnly`, `SameSite=Lax`); `state` cambiado a mano → `?ingreso=fallido` sin cookie; repetir la URL de vuelta ya usada → fallido; `?deny=1` → fallido; salir → sin sesión; la cookie del alumno no abre `/admin` y la del panel no abre el portal.
- [ ] **Step 2:** FALLAN. **Step 3:** implementar (verificar en la documentación oficial de Discord y Google las URLs, los scopes y los campos de perfil; `arctic` es opcional). **Step 4:** PASAN; lint, typecheck, test, `test:e2e` (las tres configuraciones).
- [ ] **Step 5: Commit** `feat: los alumnos entran con Discord o Google`.

### Task 3: Invitaciones desde el panel

**Files:**
- Create: `src/portal/invites.ts`, `src/admin/customers/portal-card.tsx`, `src/app/admin/alumnos/[id]/portal-actions.ts`, `tests/e2e/portal-invites.spec.ts`
- Modify: `src/app/admin/alumnos/[id]/page.tsx`, la ruta de vuelta de la Tarea 2 (canje)
- Test: `tests/unit/portal-invites.test.ts`, `tests/unit/portal-admin-actions.test.ts`

**Interfaces:**
- Produces (`invites.ts`): `createInvite(db, customerId, now?): Promise<string>` (token en claro de 32 bytes base64url; anula las invitaciones sin usar de ese alumno); `redeemInvite(db, token, accountId, now?): Promise<"linked" | "invalid" | "account-linked-elsewhere" | "customer-has-account">` (atómico: marca `usedAt` solo si el vínculo se hizo); `inviteUrl(token, locale = "es"): string` → `${SITE_URL}/${locale}/portal?invitacion=${token}`.
- Acciones del panel (todas con `await requireAdmin();` primero): `createPortalInviteAction(customerId)` → `{ ok: true; url: string; expiresAt: string }` (se muestra una vez, con botón copiar); `unlinkPortalAccountAction(customerId)` (desvincula y cierra sus sesiones); `deletePortalAccountAction(customerId)` (borra la cuenta; pide confirmación en la UI).
- Ficha del alumno: tarjeta "Portal del alumno": vinculado (proveedor y nombre para mostrar) o no; botones de la spec.
- Portal (lo usa la Tarea 5): si la vuelta trae invitación, el resultado del canje viaja como `?invitacion=vinculada|invalida|ocupada` al portal.

- [ ] **Step 1: Tests que fallan.** Unit: canje correcto vincula y marca usada; segunda vez `"invalid"`; vencida (14 días) `"invalid"`; nueva invitación anula la anterior; alumno que ya tiene cuenta → `"customer-has-account"` sin marcar usada; cuenta vinculada a otro → `"account-linked-elsewhere"`; el token no se guarda en claro. Acciones: sin `requireAdmin` no hacen nada (patrón de `tests/unit/billing-guards.test.ts`); desvincular cierra las sesiones de esa cuenta. E2e: en el panel, invitar → abrir el link en otro contexto → entrar con el proveedor de prueba → la ficha muestra "vinculado"; el mismo link en un tercer contexto → `?invitacion=invalida`.
- [ ] **Step 2:** FALLAN. **Step 3:** implementar. **Step 4:** PASAN; lint, typecheck, test, `test:e2e`.
- [ ] **Step 5: Commit** `feat: Tallami invita a cada alumno a su portal desde el panel`.

### Task 4: Entregas desde el panel

**Files:**
- Create: `src/portal/deliveries.ts`, `src/portal/files.ts`, `src/portal/youtube.ts`, `src/admin/sales/deliveries-card.tsx`, `src/app/admin/ventas/[id]/delivery-actions.ts`, `src/app/admin/ventas/[id]/entregas/[deliveryId]/route.ts`, `src/app/api/portal/files/[deliveryId]/route.ts`, `tests/e2e/portal-deliveries-admin.spec.ts`
- Modify: `src/app/admin/ventas/[id]/page.tsx`, `next.config.ts` (límite del cuerpo de las Server Actions a 4,5 MB si hace falta; verificar el nombre exacto de la opción en Next 16)
- Test: `tests/unit/portal-youtube.test.ts`, `tests/unit/portal-deliveries.test.ts`, `tests/unit/portal-files-route.test.ts`

**Interfaces:**
- Produces (`youtube.ts`): `youtubeVideoId(raw: string): string | null` — acepta `https://(www.|m.)youtube.com/watch?v=ID`, `https://youtu.be/ID`, `https://www.youtube.com/live/ID`, `https://www.youtube.com/shorts/ID`; ID = 11 caracteres `[A-Za-z0-9_-]`; cualquier otra cosa → `null`.
- Produces (`files.ts`): `interface DeliveryFileStore { put(db, bytes: Uint8Array, contentType: "application/pdf"): Promise<string>; get(db, id): Promise<{ bytes: Uint8Array; contentType: string; size: number } | null>; remove(db, id): Promise<void> }` y `dbFileStore` (tabla `delivery_files`); `isPdf(bytes): boolean` (`%PDF-` al principio).
- Produces (`deliveries.ts`): `addYoutubeDelivery(db, saleId, title, url)`, `addPdfDelivery(db, saleId, title, bytes)`, `addLinkDelivery(db, saleId, title, url)` (cada una valida y devuelve `{ ok: true } | { ok: false; error: "invalid-title" | "invalid-url" | "not-pdf" | "too-large" | "sale-not-found" }`), `deleteDelivery(db, deliveryId)` (borra también su archivo), `listDeliveriesForSale(db, saleId)`, `deliveryForStudent(db, deliveryId, customerId): Promise<Delivery | null>` (solo si la venta es de ese alumno).
- Rutas de archivos: `/admin/ventas/[id]/entregas/[deliveryId]` (con `requireAdmin()`) y `/api/portal/files/[deliveryId]` (sesión de alumno + `deliveryForStudent`; si no → 404 sin cuerpo útil). Encabezados: `Content-Type: application/pdf`, `Content-Disposition: inline; filename="entrega.pdf"`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`.
- Panel: tarjeta "Entregas" en la ficha de la venta (tipo, título, campo de link o archivo, lista con fecha y borrar con confirmación).

- [ ] **Step 1: Tests que fallan.** `youtubeVideoId` con cada forma válida, con `http://`, con otro dominio parecido (`youtube.com.evil.com`, `notyoutube.com`), con ID corto/largo → `null`. Entregas: título vacío o de 121 caracteres; PDF de 4 MB + 1 byte → `"too-large"`; bytes que no empiezan con `%PDF-` → `"not-pdf"`; link `http://` o `javascript:` → `"invalid-url"`; borrar quita el archivo. Ruta del portal: sin sesión 404; sesión de otro alumno 404; dueño 200 con los encabezados exactos. E2e del panel: subir un PDF chico, agregar un YouTube y un link, verlos listados, borrar uno.
- [ ] **Step 2:** FALLAN. **Step 3:** implementar (verificar en la documentación de Vercel el límite del cuerpo de las funciones y en la de Next el de las Server Actions). **Step 4:** PASAN; lint, typecheck, test, `test:e2e`.
- [ ] **Step 5: Commit** `feat: Tallami carga entregas (YouTube, PDF o link) en cada venta`.

### Task 5: La página del alumno

**Files:**
- Create: `src/app/[locale]/portal/page.tsx`, `src/portal/purchases.ts`, `src/components/portal/*` (vista de ingreso, vista sin vincular, lista de compras, tarjeta de entrega, reproductor de YouTube), `tests/e2e/portal-page.spec.ts`
- Modify: `messages/es.json`, `messages/pt.json`, `messages/en.json` (namespace `Portal` y la clave del pie), `src/components/home/site-footer.tsx` (enlace "Portal de alumnos")
- Test: `tests/unit/portal-purchases.test.ts`, `tests/unit/portal-messages.test.ts`

**Interfaces:**
- Produces (`purchases.ts`): `type StudentPurchase = { id: string; item: SaleItem; status: SaleStatus; paidOn: string | null; amountMinor: number; currency: Currency; deliveries: StudentDelivery[] }` y `type StudentDelivery = { id: string; kind: "youtube" | "pdf" | "link"; title: string; createdAt: string; youtubeVideoId?: string; url?: string; fileHref?: string }`; `listStudentPurchases(db, customerId): Promise<StudentPurchase[]>` (más nuevas primero; solo campos del tipo).
- Página `/[locale]/portal`: sin sesión → botones de los proveedores habilitados (y el aviso de invitación si viene `?invitacion=` sin sesión: "Entrá para vincular tu cuenta"); `?ingreso=fallido` → aviso; sesión sin vincular → "Tu cuenta todavía no está vinculada. Pedile a Tallami tu invitación."; vinculada → nombre, lista de compras con entregas; botón "Salir" (form POST). Si el portal no está configurado → "todavía no disponible". `noindex`.
- YouTube: `<iframe src="https://www.youtube-nocookie.com/embed/{id}" title="{título}" loading="lazy" allow="…" allowfullscreen>` + link "Abrir en YouTube". Si el sitio tiene CSP algún día, debe permitir `frame-src https://www.youtube-nocookie.com`.

- [ ] **Step 1: Tests que fallan.** `listStudentPurchases`: las claves de cada compra y entrega son exactamente las del tipo (nunca `notes`, `invoice*`, `ars*`, `usd*`, `rate*`, `method`, `customerId`); solo las ventas de ese alumno. Mensajes: las tres traducciones tienen las mismas claves del namespace `Portal`. E2e (`portal-page.spec.ts`): alumno A vinculado (invitación + proveedor de prueba) ve sus dos compras con un YouTube embebido, un PDF que abre y un link; alumno B no ve nada de A y abrir el PDF de A con su sesión da 404; sin sesión ve los botones; `?ingreso=fallido` muestra el aviso; en `/pt/portal` y `/en/portal` los textos están traducidos; axe sin violaciones serias ni críticas a 375 y 1440; `/es` `/pt` `/en` siguen ○ (verificar en la salida de `next build`).
- [ ] **Step 2:** FALLAN. **Step 3:** implementar con la marca del sitio. **Step 4:** PASAN; lint, typecheck, test, `test:e2e`, `next build`.
- [ ] **Step 5: Commit** `feat: la página del alumno con sus compras y entregas`.

### Task 6: Guía y calidad

**Files:**
- Modify: `README.md` (sección nueva "Portal del alumno"), `.env.example`
- Test: `tests/unit/readme-portal-guide.test.ts`

- [ ] **Step 1: README** en español simple: qué es el portal; crear la app de Discord (Developer Portal → OAuth2: URL de vuelta `https://<tu dominio>/api/portal/auth/discord/callback`, scopes) y el cliente de Google (Google Cloud: pantalla de consentimiento externa, URL de vuelta `…/google/callback`), con enlaces a la documentación oficial verificados y sin nombrar botones no verificados; variables en Vercel (`PORTAL_SESSION_SECRET` generado con `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`, `DISCORD_*`, `GOOGLE_*`); `npm run db:migrate` antes de desplegar (0006); invitar a un alumno; cargar entregas (YouTube no listado, PDF ≤ 4 MB, link para lo grande); el límite de espacio de la base gratuita de Supabase y que los PDF se guardan en la base; los datos que se guardan de cada alumno (proveedor, id, nombre, email verificado) y que la política de privacidad queda para la investigación legal. Test: el README nombra las cinco variables y las dos URLs de vuelta.
- [ ] **Step 2:** `.env.example` con las variables nuevas (sin valores) y `PORTAL_OAUTH_TEST_ISSUER` marcada solo para tests.
- [ ] **Step 3:** `npm run lint && npm run typecheck && npm run test && npm run test:e2e` y `next build` sin warnings, `/es` `/pt` `/en` ○.
- [ ] **Step 4: Commit** `docs: guía del portal del alumno`.
