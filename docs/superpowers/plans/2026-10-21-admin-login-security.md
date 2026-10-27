# Seguridad del ingreso al panel — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al panel `/admin` solo se entre con la contraseña **y** una llave de acceso (passkey) de un dispositivo de Tallami, con sesiones guardadas en la base que se cierran solas, avisos por email y recuperación.

**Architecture:** Las sesiones pasan de "JWT y nada más" a una fila en la base por sesión; la cookie sigue siendo un JWT firmado y ahora lleva el id de la sesión (`sid`). El `proxy` verifica solo la firma (sin base); `requireAdmin()` verifica además la fila (abierta, no vencida, menos de 30 min sin uso). El ingreso tiene dos pasos: la contraseña crea un "ingreso a medio camino" (fila de 5 minutos atada a su propia cookie) y la llave (WebAuthn con SimpleWebAuthn) lo convierte en sesión. Las acciones delicadas piden "confirmación reciente" con la llave.

**Tech Stack:** Next.js 16.4 (App Router, `src/proxy.ts`, Server Actions, `after()`), TypeScript, Drizzle 0.45 + PGlite/postgres.js, `jose`, `@simplewebauthn/server` + `@simplewebauthn/browser` (14.x), `resend`, Vitest, Playwright (autenticador virtual de Chrome por CDP).

**Spec:** `docs/superpowers/specs/2026-10-21-admin-login-security-design.md` (leerlo entero antes de cada tarea).

## Global Constraints

- Rama `feat/admin-login-security`. Commits por tarea o grupo, mensajes convencionales en español, staging por ruta explícita (nunca `git add -A`), cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tiempos y valores (en `src/admin/auth/policy.ts`, una sola vez): sesión **30 min sin uso** y **8 h** como máximo; escritura del último uso como mucho **1 por minuto**; ingreso a medio camino **5 min**; desafío WebAuthn **5 min**, un solo uso; confirmación reciente **5 min**; código para otro dispositivo **10 caracteres** del alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, vence a los **10 min**, un solo uso, guardado como hash; registros de sesiones se borran a los **30 días**; nombre de una llave de 1 a 40 caracteres.
- Límite de intentos igual que hoy: **5 fallidos cada 15 minutos** por conexión (IPv6 por /64, `loginIpHash`). Cuentan como fallos: contraseña incorrecta, llave inválida o de otra cuenta, código incorrecto o vencido.
- WebAuthn: `userVerification: "required"` (y `requireUserVerification: true` al verificar), `attestationType: "none"`, `residentKey: "preferred"`, sin `authenticatorAttachment`, transportes permitidos incluido `hybrid`. `rpID` y origen **siempre** de la configuración (`getWebAuthnConfig()`), nunca del encabezado `Host`.
- Contador de firma estricto (lo que hace SimpleWebAuthn por defecto: rechaza un contador que no sube salvo que ambos sean 0).
- Con al menos una llave registrada, **ningún** camino entra ni registra una llave con la contraseña sola. La última llave no se puede borrar.
- Todas las tablas nuevas con `.enableRLS()` y migración generada con `npm run db:generate`.
- `requireAdmin()` primero en cada página, acción y ruta fuera de `src/app/admin/login/` y `setup/` (lo hace cumplir `tests/unit/admin-guards.test.ts`); las páginas y acciones de `login/` hacen sus propias verificaciones (cookie del ingreso a medio camino) y cada una tiene test.
- Emails: nunca demoran ni rompen nada (se mandan con `after()`, errores solo al log); nunca llevan contraseñas, códigos ni enlaces para entrar.
- UI del panel en español rioplatense (voseo), con el estilo y los componentes de `src/admin/ui/*`; cómoda a 375 px; axe sin violaciones serias ni críticas; foco visible.
- Sitio público intacto: `/es` `/pt` `/en` siguen ○ estáticas; ningún import del panel desde `src/app/[locale]`.
- Tests sin red. `DATABASE_URL` vacía en todo servidor, test y script que se corra. Escribir archivos con Write/Edit (escapes `\u`, nunca un NUL o BOM literal), no heredocs. Servidores que se arranquen se paran por PID; nunca `taskkill /IM node.exe`; el puerto 3000 es de Tallami (no tocarlo).
- Documentación de librerías por context7 (`/websites/simplewebauthn_dev`, `/vercel/next.js/v16.2.9`, Resend, Chrome DevTools Protocol `WebAuthn` domain), no de memoria.

## Review Focus

1. **El navegador cancela o no encuentra la llave** (`NotAllowedError`: Tallami toca "Cancelar", o el dispositivo no tiene llave): mensaje en español con "Probar de nuevo" y la pista del código QR / "Tengo un código"; no cuenta como intento fallido (no llega al servidor). Test en la Tarea 3.
2. **Origen equivocado** (entrar por `127.0.0.1`, la IP de la red o un deploy de vista previa `*.vercel.app` distinto del dominio configurado): WebAuthn tira `SecurityError`; el panel dice "Las llaves solo funcionan en {origen configurado}" en vez de un error genérico. Test en la Tarea 3; nota en el README (Tarea 7).
3. **Ingreso a medio camino reusado** (botón "atrás" después de entrar, una pestaña vieja, pasados 5 min): vuelve al login con "Tu ingreso venció, empezá de nuevo"; nunca crea una segunda sesión. Test en la Tarea 3.
4. **Sesión cerrada en otro dispositivo con un formulario abierto** ("cerrar todas" desde el celular mientras la PC tiene una venta a medio cargar): al enviar, termina en el login y, al volver, el formulario recupera lo escrito. Test en la Tarea 6.
5. **Borrar la llave del dispositivo perdido**: las sesiones abiertas con esa llave se cierran en el acto (si es la actual, va al login). Test en la Tarea 4.

---

### Task 1: Sesiones guardadas en la base

Las sesiones existen en la base y se pueden cerrar; el ingreso sigue siendo solo con contraseña hasta la Tarea 3 (cada ingreso crea una fila sin llave).

**Files:**
- Create: `src/admin/auth/policy.ts`, `src/admin/auth/sessions.ts`, `src/admin/auth/device.ts`, `drizzle/0004_*.sql` (generada)
- Modify: `src/db/schema.ts` (las cuatro tablas nuevas, todas en esta migración), `src/admin/auth/session.ts`, `src/admin/auth/require-admin.ts`, `src/app/admin/login/actions.ts`, `src/app/admin/actions.ts` (logout), `tests/helpers/admin.ts`
- Test: `tests/unit/admin-sessions.test.ts`, `tests/unit/admin-device.test.ts`, `tests/unit/admin-auth.test.ts`, `tests/unit/admin-require-admin.test.ts`, `tests/unit/db-rls.test.ts`, `tests/e2e/admin-auth.spec.ts`, `tests/e2e/admin-billing.spec.ts` (~558)

**Interfaces:**
- Produces (schema, `src/db/schema.ts`):
  - `adminPasskeys` (`admin_passkeys`): `id uuid pk default random`, `credentialId text not null unique`, `publicKey text not null` (COSE en base64url), `counter bigint(number) not null default 0`, `transports text[] not null default '{}'`, `name text not null` (check 1–40), `createdAt`, `lastUsedAt` (nullable).
  - `adminSessions` (`admin_sessions`): `id text pk`, `passkeyId uuid null → admin_passkeys.id on delete set null`, `device text not null`, `createdAt`, `lastSeenAt`, `expiresAt`, `reauthAt` (null), `revokedAt` (null), `challenge text null`, `challengePurpose text null` (check `reauth|register`), `challengeExpiresAt` (null).
  - `adminPendingLogins` (`admin_pending_logins`): `id text pk`, `mode text not null` (check `passkey|first-key|code`), `nextPath text not null`, `ipHash text not null`, `device text not null`, `challenge text null`, `createdAt`, `expiresAt`, `consumedAt` (null).
  - `adminEnrollmentCodes` (`admin_enrollment_codes`): `id uuid pk`, `codeHash text not null unique`, `createdBySession text not null → admin_sessions.id on delete cascade`, `createdAt`, `expiresAt`, `usedAt` (null).
- Produces (`src/admin/auth/policy.ts`): `SESSION_IDLE_MS`, `SESSION_MAX_MS`, `SESSION_TOUCH_INTERVAL_MS`, `PENDING_LOGIN_MS`, `CHALLENGE_MS`, `REAUTH_WINDOW_MS`, `ENROLLMENT_CODE_MS`, `ENROLLMENT_CODE_LENGTH`, `ENROLLMENT_CODE_ALPHABET`, `SESSION_RETENTION_MS`, `PASSKEY_NAME_MAX_LENGTH` con los valores de Global Constraints.
- Produces (`src/admin/auth/session.ts`): `createSessionToken(sessionId: string): Promise<string>` (exp = 8 h, claim `sid`), `readSessionClaims(token: string | undefined): Promise<{ sessionId: string } | null>`, `verifySessionToken(token)` sigue (boolean, lo usa el `proxy`), `sessionCookieOptions(secure)` con `maxAge` 8 h. Se quita `SESSION_HOURS = 12`.
- Produces (`src/admin/auth/sessions.ts`): `type AdminSession = { id: string; passkeyId: string | null; device: string; createdAt: Date; lastSeenAt: Date; reauthAt: Date | null }`; `createSession(db, { passkeyId: string | null; device: string; reauthed: boolean }, now?: Date): Promise<string>`; `validateSession(db, sessionId: string, now?: Date): Promise<AdminSession | null>` (y actualiza `lastSeenAt` si pasó más de 1 min); `revokeSession(db, id, now?)`; `revokeAllSessions(db, now?): Promise<number>`; `revokeSessionsForPasskey(db, passkeyId, now?): Promise<string[]>` (ids cerrados); `listActiveSessions(db, now?): Promise<AdminSession[]>`; `purgeExpiredAuthRecords(db, now?)` (sesiones de más de 30 días, ingresos a medio camino y códigos vencidos hace más de un día).
- Produces (`src/admin/auth/require-admin.ts`): `requireAdmin(): Promise<void>` (misma firma), `getAdminSession(): Promise<AdminSession>` (envuelta en `cache()` de React; redirige como `requireAdmin` si no hay sesión válida), `hasAdminSession(): Promise<boolean>` (ahora con la base).
- Produces (`src/admin/auth/device.ts`): `describeDevice(userAgent: string | null): string` — "Chrome en Windows", "Safari en iPhone", "Edge en Windows", "Chrome en Android", "Firefox en Mac"…; desconocido → "Navegador desconocido". Máximo 60 caracteres.

- [ ] **Step 1: Tests que fallan.** `admin-sessions.test.ts` (con `createTestDb()` y `now` inyectado):
  - una sesión creada a las 10:00 es válida a las 10:29:59 y `null` a las 10:30:00 sin uso; con uso a las 10:20 sigue válida a las 10:49;
  - aunque se use cada 10 min, a las 18:00 (8 h) es `null`;
  - revocada → `null`; `revokeAllSessions` devuelve cuántas cerró;
  - `validateSession` no escribe `lastSeenAt` dos veces dentro del mismo minuto (contar escrituras con un espía sobre `db.update` o comparar el valor);
  - `revokeSessionsForPasskey` cierra solo las de esa llave;
  - `purgeExpiredAuthRecords` borra las sesiones de más de 30 días y los ingresos a medio camino y códigos vencidos hace más de un día, y deja los demás.
  `admin-auth.test.ts`: el token lleva `sid`; `readSessionClaims` devuelve el `sid`; sin `sid`, con `sid` que no es base64url de 43 caracteres o vencido → `null`; el vencimiento es a las 8 h. `admin-require-admin.test.ts`: firma válida con un `sid` que no está en la base → `redirect("/admin/login")`. `admin-device.test.ts`: los user-agent reales de Chrome/Windows 10, Safari/iPhone, Chrome/Android, Edge, Firefox/Mac y `null`. `db-rls.test.ts`: las cuatro tablas nuevas con RLS.
- [ ] **Step 2:** `npx vitest run tests/unit/admin-sessions.test.ts tests/unit/admin-auth.test.ts tests/unit/admin-require-admin.test.ts tests/unit/admin-device.test.ts tests/unit/db-rls.test.ts` → FALLAN.
- [ ] **Step 3: Implementar** schema + `npm run db:generate` (una migración `0004_…`), `policy.ts`, `sessions.ts` (id = 32 bytes aleatorios en base64url), `device.ts`, cambios en `session.ts` y `require-admin.ts`. `loginAction`: contraseña correcta → `createSession(db, { passkeyId: null, device: describeDevice(userAgent), reauthed: false })` → cookie con `createSessionToken(id)` (en la Tarea 3 esto pasa a ser el ingreso a medio camino). `logoutAction`: `requireAdmin()`, `revokeSession` de la actual, borrar cookie, login. La limpieza (`purgeExpiredAuthRecords`) corre en `loginAction` como hoy `purgeOldAttempts`.
- [ ] **Step 4: e2e.** `admin-auth.spec.ts`: los controles positivos que firmaban una cookie válida (~148) usan la cookie de un ingreso real (`context.cookies()` tras `loginAsAdmin`); nuevos: (a) un JWT bien firmado con `sid` inexistente lleva al login; (b) después de "Cerrar sesión", reponer la cookie vieja lleva al login (hoy seguía valiendo). `admin-billing.spec.ts` (~558): la descarga con cookie usa la de un ingreso real. `signTestToken` acepta `sessionId?: string` (por defecto uno al azar, que no existe en la base).
- [ ] **Step 5:** `npm run lint && npm run typecheck && npm run test && npm run test:e2e` en verde.
- [ ] **Step 6: Commit** `feat: las sesiones del panel se guardan en la base, se cierran solas a los 30 minutos sin uso y como máximo a las 8 horas`.

### Task 2: Núcleo de llaves de acceso (sin pantallas)

**Files:**
- Create: `src/admin/auth/webauthn-config.ts`, `src/admin/auth/passkeys.ts`, `src/admin/auth/ceremonies.ts`, `src/admin/auth/pending-logins.ts`, `src/admin/auth/enrollment-codes.ts`
- Modify: `package.json` (`@simplewebauthn/server`, `@simplewebauthn/browser`), `src/admin/auth/sessions.ts` (desafíos y confirmación reciente), `src/admin/auth/rate-limit.ts`
- Test: `tests/unit/admin-webauthn-config.test.ts`, `tests/unit/admin-passkeys.test.ts`, `tests/unit/admin-ceremonies.test.ts`, `tests/unit/admin-pending-logins.test.ts`, `tests/unit/admin-enrollment-codes.test.ts`, `tests/unit/admin-rate-limit.test.ts`

**Interfaces:**
- Consumes: tablas y `policy.ts` de la Tarea 1.
- Produces (`webauthn-config.ts`): `getWebAuthnConfig(): { rpID: string; origin: string; rpName: "Panel de Tallami" }` — origen de `ADMIN_WEBAUTHN_ORIGIN` si existe y `VERCEL_ENV !== "production"`, si no `new URL(SITE_URL).origin` (`src/lib/site-url.ts`); `rpID` = su `hostname`.
- Produces (`passkeys.ts`): `type Passkey = { id; credentialId; publicKey; counter: number; transports: string[]; name; createdAt; lastUsedAt: Date | null }`; `listPasskeys(db)`, `countPasskeys(db)`, `findPasskeyByCredentialId(db, credentialId)`, `insertPasskey(db, input: NewPasskeyData & { name: string }, { onlyIfNone }: { onlyIfNone: boolean }): Promise<Passkey | null>` (`null` si `onlyIfNone` y ya hay alguna), `renamePasskey(db, id, name): Promise<boolean>`, `deletePasskeyUnlessLast(db, id): Promise<"deleted" | "last" | "missing">`, `recordPasskeyUse(db, id, newCounter, now?)`. `insertPasskey` con `onlyIfNone` y `deletePasskeyUnlessLast` corren en una transacción con `select pg_advisory_xact_lock(<constante>)` antes de contar: dos registros simultáneos de "primera llave" no pueden sumar dos.
- Produces (`ceremonies.ts`): `type NewPasskeyData = { credentialId: string; publicKey: string; counter: number; transports: string[] }`; `registrationOptions(existing: Passkey[]): Promise<PublicKeyCredentialCreationOptionsJSON>` (usuario fijo: `userID` = bytes de `"tallami-admin"`, `userName` "Tallami", `excludeCredentials` = las existentes); `verifyRegistration(response: unknown, expectedChallenge: string): Promise<NewPasskeyData | null>`; `authenticationOptions(passkeys: Passkey[]): Promise<PublicKeyCredentialRequestOptionsJSON>` (`allowCredentials` = todas, con sus transportes); `verifyAuthentication(response: unknown, expectedChallenge: string, passkey: Passkey): Promise<{ newCounter: number } | null>`. Ninguna tira: cualquier error de la librería o forma inválida → `null`.
- Produces (`pending-logins.ts`): `type PendingLogin = { id; mode: "passkey" | "first-key" | "code"; nextPath; ipHash; device; challenge: string | null }`; `PENDING_COOKIE = "tallami_admin_pending"`; `pendingCookieOptions(secure)` (`httpOnly`, `sameSite: "strict"`, `path: "/admin/login"`, `maxAge: 300`); `createPendingLogin(db, { mode, nextPath, ipHash, device }, now?): Promise<string>`; `readPendingLogin(db, id: string | undefined, now?): Promise<PendingLogin | null>` (vencido o consumido → `null`); `setPendingChallenge(db, id, challenge)`; `switchPendingToCode(db, id): Promise<boolean>`; `consumePendingLogin(db, id, now?): Promise<boolean>` (un solo `update … where consumed_at is null and expires_at > now returning`).
- Produces (`sessions.ts`, agregados): `setSessionChallenge(db, sessionId, purpose: "reauth" | "register", challenge, now?)`, `takeSessionChallenge(db, sessionId, purpose, now?): Promise<string | null>` (lo consume), `markReauthed(db, sessionId, now?)`, `hasRecentReauth(session: AdminSession, now?): boolean`.
- Produces (`enrollment-codes.ts`): `generateEnrollmentCode(db, sessionId, now?): Promise<string>` (anula los códigos sin usar anteriores; guarda HMAC del código con una clave derivada de `ADMIN_SESSION_SECRET` y contexto propio, como `hashIp`); `redeemEnrollmentCode(db, raw: string, now?): Promise<boolean>` (normaliza: mayúsculas, sin espacios ni guiones; marca `usedAt` en un solo `update … where used_at is null and expires_at > now returning`); `formatEnrollmentCode(code): string` → `"ABCDE-FGHJK"`.
- Produces (`rate-limit.ts`, agregados): `recordLoginFailure(db, ipHash, now?)`, `failuresInWindow(db, ipHash, now?): Promise<number>`, `isLoginBlocked(db, ipHash, now?): Promise<boolean>` (≥ 5 en 15 min).

- [ ] **Step 1: Tests que fallan.**
  - `admin-webauthn-config.test.ts`: con `ADMIN_WEBAUTHN_ORIGIN=http://localhost:3100` → `rpID` `localhost`, origen `http://localhost:3100`; con `VERCEL_ENV=production` se ignora y usa `SITE_URL`; nunca lee encabezados.
  - `admin-passkeys.test.ts`: `insertPasskey(…, { onlyIfNone: true })` dos veces en paralelo (`Promise.all`) → exactamente una no nula; `deletePasskeyUnlessLast` con una sola → `"last"` y sigue existiendo; con dos → `"deleted"`; `recordPasskeyUse` guarda contador y `lastUsedAt`; nombres de 0 y 41 caracteres rechazados por la base.
  - `admin-ceremonies.test.ts`: `registrationOptions` lleva `userVerification: "required"`, `residentKey: "preferred"`, `attestation: "none"`, sin `authenticatorAttachment`, `rp.id` de la configuración y `excludeCredentials` con las existentes; `authenticationOptions` con `allowCredentials` de todas; `verifyRegistration`/`verifyAuthentication` devuelven `null` ante una respuesta basura, un desafío distinto y (con `vi.mock` de `@simplewebauthn/server`) cuando la librería tira o dice `verified: false`; con la librería simulada en `verified: true` devuelven los datos y el `newCounter`.
  - `admin-pending-logins.test.ts`: válido a los 4:59, `null` a los 5:00; `consumePendingLogin` dos veces → `true` y `false`; consumido → `readPendingLogin` `null`.
  - `admin-enrollment-codes.test.ts`: 10 caracteres del alfabeto; `"abcde-fghjk"` y `" ABCDE FGHJK "` canjean el mismo código; segundo canje `false`; a los 10:00 `false`; generar uno nuevo anula el anterior; en la base no aparece el código en claro.
  - `admin-rate-limit.test.ts`: `recordLoginFailure` × 5 → `isLoginBlocked` `true`; `failuresInWindow` cuenta solo los últimos 15 min.
  - `sessions`: `hasRecentReauth` a los 4:59 `true`, a los 5:00 `false`, sin `reauthAt` `false`; `takeSessionChallenge` de un propósito distinto o vencido → `null`, y consume.
- [ ] **Step 2:** correr esos archivos → FALLAN.
- [ ] **Step 3: Implementar** los módulos con las firmas de arriba (instalar las dos librerías en su versión 13.x estable; ver la documentación para `generateRegistrationOptions`, `verifyRegistrationResponse` → `registrationInfo.credential`, `generateAuthenticationOptions`, `verifyAuthenticationResponse` con `credential: { id, publicKey, counter, transports }`; claves y ids en base64url con `isoBase64URL`).
- [ ] **Step 4:** los mismos tests → PASAN; `npm run lint && npm run typecheck && npm run test`.
- [ ] **Step 5: Commit** `feat: núcleo de llaves de acceso del panel (opciones, verificación, ingresos a medio camino, códigos)`.

### Task 3: Ingreso en dos pasos

**Files:**
- Create: `src/app/admin/login/llave/page.tsx`, `src/app/admin/login/llave/actions.ts`, `src/app/admin/login/primera-llave/page.tsx`, `src/app/admin/login/primera-llave/actions.ts`, `src/components/admin/passkey-step.tsx`, `src/components/admin/first-passkey.tsx`, `src/components/admin/webauthn-errors.ts`, `tests/helpers/webauthn.ts`, `tests/helpers/seed-e2e-passkeys.ts`, `playwright.security.config.ts`, `tests/e2e/admin-security.spec.ts`
- Modify: `src/app/admin/login/actions.ts`, `src/app/admin/login/page.tsx`, `src/admin/auth/guard.ts`, `src/admin/auth/login-errors.ts`, `tests/helpers/admin.ts`, `tests/helpers/admin-server.ts`, `playwright.config.ts`, `playwright.demo.config.ts`, `package.json` (`test:e2e` corre las tres configuraciones; `test:e2e:security`)
- Test: `tests/unit/admin-login-steps.test.ts`, `tests/unit/admin-webauthn-errors.test.ts`, `tests/unit/admin-auth-guard.test.ts`, `tests/e2e/admin-auth.spec.ts`

**Interfaces:**
- Consumes: Tareas 1 y 2.
- Produces (acciones de `login/llave/actions.ts`, sin `requireAdmin`: cada una empieza por leer `PENDING_COOKIE` y `readPendingLogin`, y por `isLoginBlocked`):
  - `beginPasskeyLoginAction(): Promise<{ ok: true; options: PublicKeyCredentialRequestOptionsJSON } | LoginStepFailure>` (exige modo `passkey`);
  - `finishPasskeyLoginAction(response: unknown): Promise<{ ok: true; redirectTo: string } | LoginStepFailure>`.
  - `type LoginStepFailure = { ok: false; error: "expired" | "blocked" | "failed" }` (en `src/admin/auth/login-errors.ts`).
- Produces (`login/primera-llave/actions.ts`): `beginFirstPasskeyAction()`, `finishFirstPasskeyAction(response: unknown, name: string)` con los mismos tipos de resultado (exige modo `first-key`; `insertPasskey(…, { onlyIfNone: true })`; si devuelve `null` → `"expired"`).
- Produces (`webauthn-errors.ts`, cliente): `describeWebAuthnError(error: unknown, origin: string): string` — `NotAllowedError` → "Cancelaste o tu dispositivo no tiene una llave para este panel. Probá de nuevo, o usá tu celular con el código QR."; `SecurityError` → `"Las llaves solo funcionan en ${origin}."`; `InvalidStateError` (registro) → "Este dispositivo ya tiene una llave registrada."; otro → "No se pudo usar la llave. Probá de nuevo."
- Produces (tests): `tests/helpers/webauthn.ts`: `testPasskey(slot: number): { credentialId: string; privateKeyPkcs8: string; publicKeyCose: string }` (determinista: escalar P-256 = SHA-256 de `"tallami-e2e-passkey-" + slot`), `enableVirtualAuthenticator(page): Promise<string>` (CDP `WebAuthn.enable` + `addVirtualAuthenticator` con `protocol: "ctap2"`, `transport: "internal"`, `hasResidentKey: true`, `hasUserVerification: true`, `isUserVerified: true`), `injectTestPasskey(page, authenticatorId, slot)` (CDP `WebAuthn.addCredential` con `signCount` de `nextSignCount(slot)`: `max(último + 1, segundos desde 2026-01-01)` por proceso, así el contador sube también contra un servidor reutilizado). `seed-e2e-passkeys.ts`: inserta las llaves de los slots 0–31 en la base de `PGLITE_DIR` (lo corre el `webServer.command` de las configuraciones main y demo antes de `npm run start`). `loginAsAdmin(page)` mantiene la firma: autenticador virtual + llave del slot `test.info().parallelIndex` + contraseña + "Usar mi llave" → espera `/admin`.
- Variables de los servidores de prueba: `ADMIN_WEBAUTHN_ORIGIN=http://localhost:<puerto>` (3100 main, 3101 demo, 3102 security).

- [ ] **Step 1: Tests que fallan.**
  - `admin-login-steps.test.ts` (mocks de `next/headers` y `next/navigation` como en `tests/unit/admin-login-action.test.ts`; `@simplewebauthn/server` simulado): contraseña correcta con 0 llaves → cookie `tallami_admin_pending` y redirección a `/admin/login/primera-llave`; con llaves → `/admin/login/llave`; **ninguna cookie de sesión** en ese paso; `finishPasskeyLoginAction` sin cookie, con ingreso vencido, consumido o de otro modo → `"expired"`; llave desconocida o verificación fallida → `"failed"` y un fallo anotado en `login_attempts`; quinto fallo → siguiente `begin…` da `"blocked"`; éxito → consume el ingreso, crea sesión con `passkeyId` y `reauthAt`, cookie de sesión, borra la cookie del ingreso y `redirectTo` = el `next` guardado; repetir el `finish` con la misma respuesta → `"expired"`. `finishFirstPasskeyAction` con una llave ya registrada (otra pestaña ganó) → `"expired"` y ninguna llave nueva.
  - `admin-webauthn-errors.test.ts`: los cuatro mensajes (con `DOMException` de cada nombre).
  - `admin-auth-guard.test.ts`: `/admin/login/llave` y `/admin/login/primera-llave` pasan sin sesión; `/admin/loginx`, `/admin/login.segments/x` y `/admin/ventas` no.
- [ ] **Step 2:** correrlos → FALLAN.
- [ ] **Step 3: Implementar** `loginAction` (contraseña correcta → `createPendingLogin` con `mode` según `countPasskeys`, `nextPath` = `next`, `ipHash`, `device`; cookie `PENDING_COOKIE`; redirección), las páginas (sin ingreso válido → `loginPath({ next, error: "expired" })`; modo equivocado → la otra página), las acciones, los componentes cliente (`startAuthentication({ optionsJSON })` / `startRegistration({ optionsJSON })` tras un clic en "Usar mi llave" / "Registrar mi llave"; campo de nombre con valor por defecto `describeDevice` del navegador; errores con `describeWebAuthnError`), el `guard` (todo `/admin/login/…` pasa sin sesión, con la misma normalización de hoy) y el aviso nuevo `"expired"` del login ("Tu ingreso venció, empezá de nuevo.").
- [ ] **Step 4: Infraestructura e2e** (ver Interfaces) y `playwright.security.config.ts`: puerto 3102, base PGlite propia y vacía, **sin** llaves sembradas, `workers: 1`, `fullyParallel: false`, `testMatch: ["**/admin-security.spec.ts"]`; las configuraciones main y demo suman `**/admin-security.spec.ts` a su `testIgnore`. Ese único archivo corre en serie (`test.describe.configure({ mode: "serial" })`) sobre la base vacía: su primer test registra la primera llave y la guarda (CDP `WebAuthn.getCredentials`) para reinyectarla (`addCredential`) en los tests siguientes; las Tareas 4, 5 y 7 le agregan tests al final.
- [ ] **Step 5: e2e.** `admin-auth.spec.ts`: solo la contraseña deja en `/admin/login/llave` y `/admin` sigue llevando al login; una llave que no está registrada (slot 99) muestra el error y no entra; después de entrar, "atrás" hasta `/admin/login/llave` y reintentar no crea otra sesión. `admin-security.spec.ts`: contraseña → `/admin/login/primera-llave` → registrar con el autenticador virtual → `/admin`; en un contexto nuevo, contraseña → `/admin/login/llave` (ya no primera llave) y `/admin/login/primera-llave` redirige.
- [ ] **Step 6:** `npm run lint && npm run typecheck && npm run test && npm run test:e2e` (las tres configuraciones) en verde.
- [ ] **Step 7: Commit** `feat: ingreso al panel en dos pasos, contraseña y llave de acceso`.

### Task 4: Configuración → Seguridad

**Files:**
- Create: `src/app/admin/configuracion/seguridad/page.tsx`, `src/app/admin/configuracion/seguridad/actions.ts`, `src/admin/security/security-view.tsx`, `src/admin/security/passkey-list.tsx`, `src/admin/security/session-list.tsx`, `src/admin/security/with-reauth.ts`, `src/app/admin/login/llave/code-actions.ts`, `src/components/admin/enrollment-code-step.tsx`; tests e2e agregados al final de `tests/e2e/admin-security.spec.ts`
- Modify: `src/admin/settings/settings-view.tsx` (enlace a Seguridad), `src/admin/routes.ts` (`security: "/admin/configuracion/seguridad"`), `src/components/admin/passkey-step.tsx` ("Tengo un código")
- Test: `tests/unit/admin-security-actions.test.ts`, `tests/unit/admin-code-actions.test.ts`

**Interfaces:**
- Consumes: Tareas 1–3.
- Produces (`seguridad/actions.ts`, todas con `await requireAdmin();` primero y luego `getAdminSession()`): `beginReauthAction()`, `finishReauthAction(response: unknown)`; las delicadas devuelven `{ ok: false; error: "reauth-required" }` si `!hasRecentReauth(session)`: `beginAddPasskeyAction()`, `finishAddPasskeyAction(response: unknown, name: string)`, `renamePasskeyAction(id: string, name: string)`, `deletePasskeyAction(id: string)` (`"last"` → mensaje "Agregá otra llave antes de borrar esta."; al borrar, `revokeSessionsForPasskey`; si cerró la actual, borra la cookie y devuelve `redirectTo: "/admin/login"`), `generateEnrollmentCodeAction()` → `{ ok: true; code: string; expiresAt: string }` (el código se muestra una sola vez, formateado), `closeAllSessionsAction()` → cierra todas, borra la cookie, `redirectTo: "/admin/login"`.
- Produces (`with-reauth.ts`, cliente): `withReauth<T>(run: () => Promise<T | { ok: false; error: "reauth-required" }>): Promise<T>` — si la acción pide confirmación, hace la ceremonia (`beginReauthAction` → `startAuthentication` → `finishReauthAction`) y reintenta una sola vez.
- Produces (`login/llave/code-actions.ts`, sin `requireAdmin`, mismas verificaciones que la Tarea 3): `redeemCodeAction(code: string)` (exige modo `passkey`; código malo → fallo anotado; bueno → `switchPendingToCode`), `beginCodePasskeyAction()`, `finishCodePasskeyAction(response: unknown, name: string)` (exige modo `code`; inserta la llave con `onlyIfNone: false`, crea la sesión con esa llave).
- La página lista: llaves (nombre, alta, último uso, "este dispositivo" no se puede saber: no mostrarlo), sesiones abiertas (dispositivo, inicio, último uso, marca "Esta sesión"), botones de la spec y el estado de los avisos (lo completa la Tarea 5; acá un espacio con "Avisos por email: sin configurar").

- [ ] **Step 1: Tests que fallan.** `admin-security-actions.test.ts` (sesión simulada con `reauthAt` controlado): cada acción delicada sin confirmación reciente → `"reauth-required"` y no cambia nada; con confirmación → hace lo suyo; borrar la única llave → `"last"`; borrar la llave con la que se abrió otra sesión → esa sesión queda cerrada; borrar la de la sesión actual → `redirectTo` login; `closeAllSessionsAction` → 0 sesiones activas; `generateEnrollmentCodeAction` dos veces → el primero ya no canjea; nombre vacío o de 41 caracteres → error de validación. `admin-code-actions.test.ts`: código correcto con ingreso en modo `passkey` → modo `code`; código incorrecto → fallo anotado; con ingreso en modo `first-key` → `"expired"`; `finishCodePasskeyAction` sin canjear antes → `"expired"`.
- [ ] **Step 2:** correrlos → FALLAN.
- [ ] **Step 3: Implementar** las acciones, la página (dentro de `PanelShell active="settings"`) y los componentes; "Tengo un código" en el paso de la llave abre el campo del código y, si se canjea, ofrece "Registrar la llave de este dispositivo".
- [ ] **Step 4: e2e** al final de `admin-security.spec.ts` (configuración security, en serie, con la primera llave que registró la Tarea 3): agregar una segunda llave (segundo autenticador virtual) → aparecen dos; renombrar; borrar la última → aviso y sigue; generar un código → en otro contexto sin llave: contraseña → "Tengo un código" → registrar → adentro; el mismo código otra vez → error; borrar la llave del otro contexto → ese contexto, al navegar, va al login; "Cerrar todas las sesiones" → los dos contextos van al login.
- [ ] **Step 5:** lint, typecheck, test y `test:e2e` en verde.
- [ ] **Step 6: Commit** `feat: Configuración → Seguridad: llaves, código para otro dispositivo, sesiones abiertas y cerrar todas`.

### Task 5: Avisos por email

**Files:**
- Create: `src/admin/alerts/config.ts`, `src/admin/alerts/render.ts`, `src/admin/alerts/send.ts`
- Modify: `package.json` (`resend`), las acciones de las Tareas 3 y 4 y `src/app/admin/login/actions.ts` (un `notifySecurityEvent` en cada evento), `src/admin/security/security-view.tsx` (estado), `.env.example`
- Test: `tests/unit/admin-alerts.test.ts`, `tests/unit/admin-alerts-wiring.test.ts`

**Interfaces:**
- Produces: `type SecurityEvent = "login" | "first-passkey" | "passkey-added" | "passkey-removed" | "code-generated" | "sessions-closed" | "login-blocked" | "passkeys-reset"`; `type AlertContext = { device: string; country: string | null; passkeyName?: string }`; `getAlertConfig(): { apiKey: string; to: string; from: string } | null` (`RESEND_API_KEY`, `ADMIN_ALERT_EMAIL`, `ADMIN_ALERT_FROM` con valor por defecto `"Panel de Tallami <onboarding@resend.dev>"`; sin las dos primeras → `null`); `renderSecurityAlert(event, context, now: Date): { subject: string; text: string; html: string }`; `sendSecurityAlert(event, context, deps?: { transport?: (message) => Promise<void>; now?: Date }): Promise<void>` (nunca tira; errores con `console.error` sin datos sensibles); `notifySecurityEvent(event, extra?: Partial<AlertContext>): void` (toma dispositivo de `user-agent` y país de `x-vercel-ip-country` del pedido y programa `sendSecurityAlert` con `after()`).
- Bloqueo: en `loginAction` y en los pasos de llave y código, después de anotar un fallo, si `failuresInWindow(...) === LOGIN_MAX_FAILURES` → `notifySecurityEvent("login-blocked")` (uno por bloqueo).

- [ ] **Step 1: Tests que fallan.** `admin-alerts.test.ts`: cada evento tiene asunto y texto en español; la hora sale en Argentina (`2026-10-21T03:30:00Z` → "21/10/2026 00:30"); incluye dispositivo y país (o "país desconocido"); incluye "Si no fuiste vos: entrá y cerrá todas las sesiones, y cambiá la contraseña"; el HTML escapa el nombre de la llave (`<script>` llega como texto); `sendSecurityAlert` con un transporte que tira no tira y lo registra; sin configuración no llama al transporte. `admin-alerts-wiring.test.ts` (con `notifySecurityEvent` espiado): ingreso con llave → `"login"`; primera llave → `"first-passkey"`; agregar/borrar llave, código, cerrar todas → su evento; cinco contraseñas malas → un solo `"login-blocked"`; un ingreso con el envío roto (transporte que tira) sigue creando la sesión.
- [ ] **Step 2:** correrlos → FALLAN.
- [ ] **Step 3: Implementar** con el SDK de Resend (`emails.send({ from, to, subject, text, html })`; ver su documentación por la dirección de prueba `onboarding@resend.dev` y a quién entrega). Seguridad muestra "Avisos por email: activos (a {email enmascarado, p. ej. t***@gmail.com})" o "sin configurar".
- [ ] **Step 4:** lint, typecheck, test en verde (e2e: el texto "sin configurar" en `admin-security.spec.ts`).
- [ ] **Step 5: Commit** `feat: aviso por email en cada ingreso y en cada cambio de seguridad del panel`.

### Task 6: Lo escrito no se pierde si la sesión vence

**Files:**
- Create: `src/admin/ui/form-draft.ts` (hook cliente), `tests/e2e/admin-drafts.spec.ts`
- Modify: `src/admin/sales/sale-form.tsx`, `src/admin/customers/student-form.tsx`, `src/admin/billing/uninvoiced-list.tsx`, `src/admin/settings/settings-form.tsx`, `src/admin/ui/admin-shell.tsx` (botón "Salir") y `src/admin/security/security-view.tsx` ("Cerrar todas las sesiones"): esos dos botones pasan por un componente cliente chico, `ClearDraftsOnSubmit`, que borra de `sessionStorage` todo lo que empieza con `tallami-draft:` al enviar
- Test: `tests/unit/form-draft.test.ts`

**Interfaces:**
- Produces: `useFormDraft(formRef: RefObject<HTMLFormElement | null>, key: string): { restored: boolean; discard: () => void }` — claves `venta:nueva`, `venta:<id>`, `alumno:nuevo`, `alumno:<id>`, `facturas:marcar`, `configuracion`. Mecanismo (Ruling D1 del ledger):
  - **Al enviar**, el hook guarda en `sessionStorage` un borrador "pendiente" (`tallami-draft:<clave>`, con la hora) con los campos del formulario, salvo `type="password"`, `type="file"` y nombres que contengan `code`.
  - **Sesión terminada:** `requireAdmin()` redirige a `loginPath({ next, error: "vencida" })`, con `next` = la ruta del `Referer` si es del mismo sitio (pasada por `safeNextPath`); el 401 del `proxy` para acciones (`x-action-redirect`) también lleva `error=vencida`. El login muestra "Tu sesión se cerró. Volvé a entrar para seguir." y, si llegó con `error=vencida`, deja en `sessionStorage` una "marca de recuperación" (`tallami-draft-claim`, con la hora).
  - **Al montar** el formulario con un borrador pendiente: si hay una marca de recuperación posterior al borrador, completa los campos (incluidos selects, radios y checkboxes de "Por facturar"), muestra el aviso de la spec ("Tu sesión se cerró por inactividad: recuperamos lo que habías escrito, revisalo y guardá.") con "Descartar", y consume la marca; si no hay marca, borra el borrador (fue un envío exitoso o abandonado). Un envío exitoso nunca reaparece.
  - `requireAdmin()` cambia su redirección: actualizar `tests/unit/admin-require-admin.test.ts` (antes esperaba exactamente `/admin/login`).

- [ ] **Step 1: Tests que fallan.** `form-draft.test.ts` (jsdom): serializa y restaura texto, número, fecha, select, radio y checkboxes; nunca guarda contraseñas ni campos de código; `discard` borra. `admin-drafts.spec.ts` (main): (a) Nueva venta completa → `context.clearCookies()` (la sesión se perdió, como si se hubiera cerrado desde otro dispositivo) → Guardar → termina en el login → entrar con contraseña y llave → Nueva venta con los datos y el aviso, y "Descartar" la vacía; (b) guardar una venta con éxito y abrir Nueva venta → vacía, sin aviso; (c) lo mismo que (a) en "Por facturar" con tipo, número, fecha y dos ventas tildadas; (d) "Salir" con un borrador guardado y volver a entrar → sin aviso; (e) sesión cerrada en la base con la cookie todavía firmada (como al vencer por inactividad): entrar, guardar la cookie (`context.cookies()`), completar Nueva venta, en otra pestaña "Salir" (cierra la fila y borra la cookie), volver a poner la cookie guardada con `context.addCookies` → Guardar en la primera pestaña → login con "Tu sesión se cerró" → entrar → vuelve a Nueva venta (por `next`) con los datos y el aviso.
- [ ] **Step 2:** correrlos → FALLAN.
- [ ] **Step 3: Implementar** el hook y usarlo en los cuatro formularios (la clave lleva el id del registro), la redirección nueva de `requireAdmin()` y del `proxy`, y la marca de recuperación en el login. Los e2e (a) y (e) son el criterio.
- [ ] **Step 4:** lint, typecheck, test, `test:e2e` en verde.
- [ ] **Step 5: Commit** `feat: si la sesión vence al guardar, el formulario recupera lo escrito después de volver a entrar`.

### Task 7: Recuperación, guía y calidad

**Files:**
- Create: `src/admin/auth/reset-passkeys.ts`, `scripts/admin-reset-passkeys.ts`
- Modify: `package.json` (`admin:reset-passkeys`), `README.md` (sección "Panel de admin"), `.env.example`, `tests/e2e/admin-security.spec.ts` (tests de calidad al final)
- Test: `tests/unit/admin-reset-passkeys.test.ts`, `tests/unit/admin-reset-passkeys-script.test.ts`

**Interfaces:**
- Produces: `resetPasskeys(db, now?): Promise<{ passkeys: number; sessions: number }>` (borra llaves, cierra sesiones, borra ingresos a medio camino y códigos, en una transacción); el script pide escribir `BORRAR LLAVES` (por terminal o por entrada redirigida), usa `getDb()` (con `DATABASE_URL` si está; si no, PGlite local), manda `"passkeys-reset"` con `sendSecurityAlert` esperado (no `after()`), e imprime qué hizo.

- [ ] **Step 1: Tests que fallan.** `admin-reset-passkeys.test.ts`: con 2 llaves, 3 sesiones, un ingreso y un código → todo borrado/cerrado y el siguiente `countPasskeys` es 0. `admin-reset-passkeys-script.test.ts` (subproceso `tsx` con `PGLITE_DIR` temporal, `DATABASE_URL` vacía): frase distinta → no toca nada y sale con código 1; frase correcta → borra.
- [ ] **Step 2:** correrlos → FALLAN. **Step 3:** implementar. **Step 4:** PASAN.
- [ ] **Step 5: Calidad.** axe (wcag2a/2aa/21aa/22aa, sin serias ni críticas) a 375 y 1440 en `/admin/login/llave`, `/admin/login/primera-llave` y `/admin/configuracion/seguridad`; sin scroll horizontal; foco visible y Tab en los botones nuevos.
- [ ] **Step 6: README** ("Panel de admin"), en español simple: el ingreso en dos pasos; activar el PIN de Windows Hello en la PC (con enlace a la ayuda oficial de Microsoft); registrar la llave en cada dispositivo (primera llave, "Agregar una llave en este dispositivo", celular por QR, código para la PC sin Bluetooth); qué hacer si pierde uno (borrar su llave desde otro) o todos (`npm run admin:reset-passkeys`, cargando `DATABASE_URL` como ya explica la sección de migraciones); la nota del dominio (las llaves quedan atadas a la dirección; los deploys de vista previa de Vercel no sirven para entrar al panel); Resend (cuenta, clave, `ADMIN_ALERT_EMAIL`, entrega solo al email de la cuenta mientras no haya dominio); y "Seguridad de tus cuentas" (segundo factor en GitHub, Vercel, Supabase y el email; variables sensibles en Vercel; apagar la API de datos de Supabase y exigir conexión cifrada), con enlaces a la documentación oficial y sin nombrar botones no verificados. Actualizar la tabla "Cómo se protege". `.env.example` con `RESEND_API_KEY`, `ADMIN_ALERT_EMAIL`, `ADMIN_ALERT_FROM` y `ADMIN_WEBAUTHN_ORIGIN` (solo tests y desarrollo).
- [ ] **Step 7:** `npm run lint && npm run typecheck && npm run test && npm run test:e2e` (tres configuraciones) y `next build` sin warnings, `/es` `/pt` `/en` ○.
- [ ] **Step 8: Commit** `feat: recuperación de las llaves del panel y guía de seguridad`.
