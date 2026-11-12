# Mensajes entre el alumno y Tallami — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada alumno con cuenta vinculada se escriba con Tallami dentro de la web: una página de mensajes en el portal, una sección Mensajes en el panel y avisos por email a los dos.

**Architecture:** Un módulo `src/chat/` con una conversación por alumno (`conversations`) y sus mensajes (`messages`). Todo mensaje entra por dos funciones (`sendStudentMessage`, `sendCoachMessage`) que, en una sola transacción con la conversación bloqueada, guardan el mensaje, mueven las marcas de lectura y dicen si corresponde un aviso por email. No hay tiempo real: un componente cliente vuelve a pedir la página cada 20 segundos con la pestaña a la vista y marca como leído con una Server Action. El módulo se llama `chat` y no `messages` para no confundirlo con `messages/*.json`, los textos del sitio.

**Tech Stack:** Next.js 16.4.3 (App Router, `cacheComponents`, Server Actions), next-intl, TypeScript, Drizzle + PGlite/postgres.js, zod, Resend, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-student-messages-design.md` (leerlo entero antes de cada tarea).

## Global Constraints

- Rama `feat/student-messages`. Commits por tarea o grupo, mensajes convencionales en español, staging por ruta explícita (nunca `git add -A`), cada commit termina con `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Valores, una sola vez en `src/chat/policy.ts`: mensaje de **1 a 2.000 caracteres** contados como los cuenta Postgres (`[...texto].length`), después de quitar NUL, pasar `\r\n` a `\n` y recortar las puntas; el alumno manda hasta **30 mensajes por hora**; el mismo texto del mismo lado dentro de **10 segundos** se guarda una sola vez; la página se refresca cada **20 segundos**; una conversación sin mensajes nuevos en **24 meses** se borra (`PUBLIC_RECORD_RETENTION_MONTHS` de `src/payments/policy.ts`); el comienzo del último mensaje en la bandeja son **80 caracteres**.
- Quién escribe: `"student"` o `"coach"`, nada más.
- El texto de un mensaje se muestra siempre como texto de React, con `white-space: pre-wrap` y `overflow-wrap: anywhere`. Nunca `dangerouslySetInnerHTML`, nunca links armados a partir del texto.
- **Ningún email lleva el texto de un mensaje.** Los logs tampoco: solo el tipo de error y ids internos.
- Acciones del alumno: la cuenta sale de la sesión (`getCurrentStudent()`) y el alumno, de esa cuenta. Del formulario llega solo el texto. Una cuenta sin vincular responde como si no hubiera nada.
- Panel: `requireAdmin()` primero en toda página y acción nueva, y antes de leer el número del menú (`tests/unit/admin-guards.test.ts`).
- En ningún texto: CUIT, email ni dirección de Tallami.
- `/es`, `/pt`, `/en` y las demás páginas públicas siguen prerenderizadas. La página de mensajes del portal es dinámica, `noindex` y con `Referrer-Policy: same-origin`.
- Tablas nuevas con `.enableRLS()`. **Una sola migración,** `drizzle/0009_student_messages.sql`, en la Tarea 1.
- Lo que ve el alumno, en es/pt/en con voseo en español; el panel, solo en español.
- Tests sin red. `DATABASE_URL` vacía en todo lo que se corra. Nunca el puerto 3000; nunca leer, imprimir ni cambiar `.env.local`; nunca tocar `.data/pglite`; servidores por PID, nunca `taskkill /IM node.exe`.
- El servidor de los e2e es compartido y corre en paralelo: cada test usa su propio alumno (`uniqueProviderStudent`), no afirma totales que otros tests cambian (del número del menú, solo que es al menos 1) y, después de navegar con un `Link` del lado del cliente, acota a `page.getByRole("main")`.
- Documentación por context7 (`/vercel/next.js`), no de memoria. UI: skill `frontend-design`, dentro de la marca (`stage`, `paper`, dorado, Saira).

## Review Focus

1. **La página se refresca sola mientras el alumno escribe:** lo que tiene escrito y sin enviar no se borra ni pierde el foco. Test en la Tarea 2.
2. **La sesión venció con la página abierta y toca Enviar:** nunca un 500 ni un "enviado" falso; se le dice que entre de nuevo y su texto sigue en el cuadro. Test en la Tarea 2.
3. **Doble clic en Enviar, o reenviar el formulario con el botón Atrás:** queda un solo mensaje. Tests en las Tareas 1 y 2.
4. **Tallami le escribe a un alumno que no tiene cuenta del portal, o que la perdió mientras él escribía:** el envío se rechaza y se le explica, porque nadie lo leería. Tests en las Tareas 1 y 3.
5. **Un mensaje de 2.000 caracteres sin espacios, en un celular:** no ensancha la página ni tapa el formulario. Test en la Tarea 2.

---

### Task 1: Tablas, dominio y avisos

**Files:**
- Create: `src/chat/policy.ts`, `src/chat/conversations.ts`, `src/chat/emails.ts`, `drizzle/0009_student_messages.sql` (generada)
- Modify: `src/db/schema.ts`, `src/portal/accounts.ts`, `src/portal/oauth/endpoints.ts`, `src/payments/retention.ts`, `src/admin/routes.ts`, `messages/{es,pt,en}.json` (`Emails.chat`)
- Test: `tests/unit/chat-conversations.test.ts`, `tests/unit/chat-emails.test.ts`, `tests/unit/portal-accounts.test.ts`, `tests/unit/payments-retention.test.ts`, `tests/unit/db-rls.test.ts`

**Interfaces:**
- Produces (schema):
  - `conversations`: `id uuid pk`, `customerId uuid not null unique → customers on delete cascade`, `studentReadAt timestamptz null`, `coachReadAt timestamptz null`, `lastMessageAt timestamptz not null`, `createdAt`. Índice en `lastMessageAt`.
  - `messages`: `id uuid pk`, `conversationId uuid not null → conversations on delete cascade`, `sender text` (check `MESSAGE_SENDERS`), `body text` (check `char_length` entre 1 y 2000), `createdAt timestamptz not null`. Índice en `(conversationId, createdAt)`.
  - `portalAccounts` suma `locale text not null default 'es'` (check `INTEREST_LOCALES`).
- Produces (`policy.ts`): `MESSAGE_SENDERS = ["student", "coach"] as const`; `type MessageSender`; `MESSAGE_MAX_LENGTH = 2000`; `STUDENT_MESSAGES_PER_HOUR = 30`; `DUPLICATE_WINDOW_MS = 10_000`; `MESSAGES_REFRESH_MS = 20_000`; `INBOX_SNIPPET_LENGTH = 80`.
- Produces (`conversations.ts`):
  ```ts
  export type ChatMessage = { id: string; sender: MessageSender; body: string; createdAt: string };
  export type SendResult =
    | { kind: "sent"; message: ChatMessage; notify: boolean }
    | { kind: "duplicate" }
    | { kind: "invalid" }
    | { kind: "rate-limited" }
    | { kind: "no-account" };
  export function cleanMessageBody(raw: string): string | null;
  export function sendStudentMessage(db: Db, customerId: string, body: string, now?: Date): Promise<SendResult>;
  export function sendCoachMessage(db: Db, customerId: string, body: string, now?: Date): Promise<SendResult>;
  export function listMessages(db: Db, customerId: string): Promise<ChatMessage[]>;
  export function markRead(db: Db, customerId: string, reader: MessageSender, now?: Date): Promise<void>;
  export function unreadForStudent(db: Db, customerId: string): Promise<number>;
  export type InboxRow = { customerId: string; customerName: string; lastMessageAt: string; lastSender: MessageSender; snippet: string; unread: number };
  export function listInbox(db: Db): Promise<InboxRow[]>;
  export function countUnreadConversations(db: Db): Promise<number>;
  export function deleteConversation(db: Db, customerId: string): Promise<boolean>;
  export function purgeStaleConversations(db: Db, now: Date): Promise<void>;
  ```
- Produces (`emails.ts`): `notifyChatMessage(db: Db, customerId: string, sender: MessageSender, deps?: EmailDeps): Promise<void>`. Nunca tira.
- Produces (`routes.ts`): `ADMIN_ROUTES.messages = "/admin/mensajes"`; `conversationHref(customerId: string): string`.
- Produces (`accounts.ts`): `PortalAccount` suma `locale: Locale`; `upsertAccountFromIdentity(db, identity, now?, locale?)` guarda `locale` al crear y al actualizar cuando se le pasa, y no lo toca cuando no.

- [ ] **Step 1: Tests que fallan del dominio**, con `createTestDb()` y los ayudantes de `tests/helpers/portal.ts`.
  - `cleanMessageBody("  hola\r\nchau \u0000 ")` da `"hola\nchau"`; `""`, `"   "` y `"\n\n"` dan `null`; 2.000 caracteres pasa y 2.001 da `null`; 2.000 emojis (cada uno un carácter para Postgres) pasan.
  - Primer mensaje del alumno: crea la conversación, `kind: "sent"`, `notify: true`, `lastMessageAt` y `studentReadAt` iguales a `now`, `coachReadAt` en `null`.
  - **Segundo mensaje del alumno sin que Tallami haya leído: `notify: false`.** Después de `markRead(…, "coach")`, el siguiente del alumno vuelve a dar `notify: true`.
  - Lo mismo al revés para `sendCoachMessage` y `markRead(…, "student")`.
  - Un mensaje de Tallami no cambia el `notify` de los del alumno, y al revés.
  - **El mismo texto del mismo lado a los 9 segundos: `duplicate`, una sola fila. A los 11 segundos, o del otro lado, se guarda.**
  - El mensaje 31 del alumno dentro de la hora: `rate-limited`, sin fila. A la hora y un segundo del primero, pasa. Tallami manda 40 seguidos sin tope.
  - Vacío o de más de 2.000: `invalid`, sin conversación nueva.
  - **`sendCoachMessage` a un alumno sin cuenta vinculada: `no-account`, sin fila.** A un alumno que no existe o un id que no es UUID: `no-account`. `sendStudentMessage` con un id que no existe o que no es UUID: `invalid`.
  - `listMessages`: del más viejo al más nuevo; `[]` sin conversación, con un id ajeno o que no es UUID. Los mensajes de un alumno nunca aparecen en la lista de otro.
  - `unreadForStudent`: cuenta los de Tallami posteriores a `studentReadAt`; 0 sin conversación.
  - `listInbox`: primero las que tienen algo sin leer para Tallami, después por `lastMessageAt` descendente; `snippet` son los primeros 80 caracteres del último mensaje en una sola línea; `unread` cuenta los del alumno posteriores a `coachReadAt`. `countUnreadConversations` cuenta conversaciones, no mensajes.
  - `markRead` sin conversación no hace nada y no la crea.
  - `deleteConversation` borra la conversación con sus mensajes y devuelve `true`; sin conversación, `false`. El alumno y sus ventas quedan.
  - `purgeStaleConversations`: borra la de `lastMessageAt` de hace 24 meses y un día, deja la de 23 meses. `purgeExpiredRecords` la llama.
- [ ] **Step 2: Tests que fallan de los avisos** (transporte falso).
  - `sender: "student"`: un email a Tallami con el nombre del alumno en el asunto y `{SITE_URL}/admin/mensajes/{customerId}` en el texto.
  - `sender: "coach"`: un email al email de la cuenta vinculada, en el idioma de la cuenta (`pt` da el asunto en portugués), con `{SITE_URL}/pt/portal/mensajes`.
  - **Ninguno contiene el texto del mensaje** (se manda un mensaje con una palabra única y se comprueba que no está en ningún email).
  - Cuenta sin email, alumno sin cuenta, id que no existe: no manda nada y no tira. Un transporte que tira no propaga.
  - El email al alumno no contiene `ADMIN_ALERT_EMAIL`.
- [ ] **Step 3: Tests que fallan de la cuenta.** `upsertAccountFromIdentity(db, identity, now, "pt")` guarda `locale: "pt"`; otra llamada sin idioma lo deja en `"pt"`; con `"en"` lo cambia; una cuenta nueva sin idioma queda en `"es"`. La vuelta del ingreso pasa el idioma del flujo. `db-rls.test.ts` sigue pasando con las tablas nuevas.
- [ ] **Step 4:** correrlos (`npx vitest run tests/unit/chat-conversations.test.ts tests/unit/chat-emails.test.ts tests/unit/portal-accounts.test.ts tests/unit/payments-retention.test.ts tests/unit/db-rls.test.ts`) → FALLAN.
- [ ] **Step 5: Implementar.**
  - Cada envío corre en una transacción: crea la conversación si falta (`insert … on conflict do nothing`), la bloquea (`for no key update`; ver el comentario de `createInvite` en `src/portal/invites.ts`), decide `duplicate`, el tope y `notify`, inserta el mensaje y actualiza `lastMessageAt` y la marca de lectura de quien escribe.
  - `notify` es verdadero cuando, antes de este mensaje, el otro lado no tenía mensajes de este lado sin leer.
  - `npm run db:generate -- --name student_messages`.
  - Textos de `Emails.chat` en los tres idiomas: asunto "Tallami te escribió", un saludo con el nombre, una línea que dice que tiene un mensaje nuevo en su portal, el enlace y la firma "Tomás Allami (Tallami)". El email a Tallami va en español, con el asunto "Mensaje nuevo de {nombre}".
- [ ] **Step 6:** los mismos tests más `npx vitest run` y `npx tsc --noEmit` → PASAN.
- [ ] **Step 7: Commit** `feat: conversaciones, mensajes y avisos por email`.

### Task 2: El alumno: sus mensajes en el portal

**Files:**
- Create: `src/app/[locale]/portal/mensajes/page.tsx`, `src/app/[locale]/portal/mensajes/actions.ts`, `src/components/chat/message-thread.tsx`, `src/components/chat/compose-form.tsx`, `src/components/chat/auto-refresh.tsx`, `src/components/chat/local-time.tsx`, `src/components/portal/messages-content.tsx`, `src/components/portal/messages-card.tsx`, `tests/helpers/chat-e2e.ts`
- Modify: `src/components/portal/portal-content.tsx`, `next.config.ts`, `messages/{es,pt,en}.json` (namespace `Chat`)
- Test: `tests/unit/chat-student-actions.test.ts`, `tests/unit/portal-content.test.ts`, `tests/unit/messages.test.ts`, `tests/e2e/chat-portal.spec.ts`

**Interfaces:**
- Consumes: Tarea 1 (`sendStudentMessage`, `listMessages`, `markRead`, `unreadForStudent`, `notifyChatMessage`, `MESSAGE_MAX_LENGTH`, `MESSAGES_REFRESH_MS`).
- Produces (`actions.ts`):
  ```ts
  export type ChatFormState = { outcome: "idle" | "sent" | "invalid" | "rate-limited" | "signed-out" | "failed"; body: string };
  export function sendStudentMessageAction(previous: ChatFormState, formData: FormData): Promise<ChatFormState>;
  export function markStudentReadAction(): Promise<void>;
  ```
  `body` vuelve con lo que el alumno escribió cuando el envío no salió, y vacío cuando salió.
- Produces (componentes compartidos con el panel, Tarea 3):
  - `MessageThread({ messages, viewer, labels, timeZone })`: `viewer: MessageSender` decide de qué lado va cada mensaje; `labels: { own: string; other: string; empty: string }`; `timeZone?: string` fija la zona (el panel pasa la de Argentina) y, sin ella, usa la del navegador.
  - `ComposeForm({ action, initialState, labels, maxLength })`: `action: (previous: ChatFormState, formData: FormData) => Promise<ChatFormState>`; el campo se llama `body`.
  - `AutoRefresh({ intervalMs, incoming, markRead })`: `incoming: number` es cuántos mensajes del otro lado hay; `markRead: () => Promise<void>`.

- [ ] **Step 1: Tests unitarios que fallan de las acciones.**
  - Con sesión de una cuenta vinculada: guarda el mensaje y devuelve `{ outcome: "sent", body: "" }`.
  - **Sin sesión: `{ outcome: "signed-out", body: <lo escrito> }`, sin fila.** Cuenta sin vincular: lo mismo.
  - Texto inválido y tope pasado: `invalid` y `rate-limited`, con `body` devuelto.
  - La base tira: `failed` con `body` devuelto, y nunca propaga.
  - Un `customerId` o `conversationId` en el formulario se ignora: el mensaje va a la conversación de la cuenta.
  - El aviso por email se programa con `after` solo cuando el envío dio `notify: true`.
  - `markStudentReadAction` sin sesión no hace nada.
- [ ] **Step 2: e2e que falla** (`tests/e2e/chat-portal.spec.ts`). `tests/helpers/chat-e2e.ts` deja un alumno con cuenta vinculada (comprando con los ayudantes de `tests/helpers/checkout-e2e.ts` o invitándolo con los de `tests/helpers/portal-admin-ui.ts`).
  - La página del portal muestra la tarjeta "Mensajes con Tallami" arriba de las compras, con su enlace. La página de mensajes vacía invita a escribir.
  - Escribe "hola", toca Enviar: el mensaje aparece, el cuadro queda vacío y con el foco. Al recargar sigue ahí.
  - **Lo que escribe no se pierde con el refresco:** con texto sin enviar en el cuadro, el mismo alumno manda otro mensaje desde otro contexto de navegador; cuando ese mensaje aparece en la primera pestaña, el texto sin enviar sigue en el cuadro.
  - **Doble clic en Enviar deja un solo mensaje.**
  - **Sesión vencida:** se borra la cookie `tallami_alumno` con la página abierta y se envía: aparece el aviso de que entre de nuevo, el texto sigue en el cuadro y al entrar otra vez el mensaje no está.
  - Vacío no se envía. 2.001 caracteres se rechazan también con el `maxlength` quitado del HTML.
  - **2.000 caracteres sin espacios a 375 px:** `document.documentElement.scrollWidth` no pasa de `clientWidth` y el botón Enviar se ve.
  - `<script>alert(1)</script>` se ve como texto y no abre ningún diálogo.
  - Sin JavaScript: enviar funciona y el mensaje aparece.
  - Cuenta sin vincular: no hay tarjeta en el portal, y la página de mensajes explica que se habilitan con la primera compra y lleva a los servicios. Sin sesión: ofrece entrar.
  - Otro alumno no ve estos mensajes en su página.
  - En `/pt` y `/en` los textos están traducidos. `axe` sin violaciones serias ni críticas, en celular y en pantalla ancha.
- [ ] **Step 3:** correrlos → FALLAN.
- [ ] **Step 4: Implementar.**
  - La página sigue el patrón de `/[locale]/portal`: encabezado y pie estáticos, lo personal en `Suspense` con `connection()`. `noindex` y `Referrer-Policy: same-origin` (sumar la ruta a la regla de `next.config.ts`).
  - `AutoRefresh` llama `router.refresh()` cada `MESSAGES_REFRESH_MS` solo con `document.visibilityState === "visible"`, y llama `markRead` al montarse y cada vez que `incoming` sube con la pestaña a la vista. No vuelve a montar el formulario.
  - Al abrir la página, lo último queda a la vista.
  - La tarjeta del portal usa un plural ICU: sin mensajes nuevos, "1 mensaje sin leer", "N mensajes sin leer".
  - El formulario marca el botón como ocupado mientras envía.
- [ ] **Step 5:** `npx vitest run` y `npx playwright test tests/e2e/chat-portal.spec.ts tests/e2e/portal-page.spec.ts tests/e2e/checkout.spec.ts tests/e2e/interest.spec.ts` → PASAN.
- [ ] **Step 6: Commit** `feat: mensajes con Tallami en el portal del alumno`.

### Task 3: Tallami: la sección Mensajes del panel

**Files:**
- Create: `src/app/admin/mensajes/page.tsx`, `src/app/admin/mensajes/[customerId]/page.tsx`, `src/app/admin/mensajes/actions.ts`, `src/admin/chat/inbox-list.tsx`, `src/admin/chat/conversation-header.tsx`, `src/admin/chat/delete-conversation.tsx`, `src/admin/chat/unread-count.ts`
- Modify: `src/admin/ui/sections.ts`, `src/admin/ui/admin-shell.tsx`, `src/app/admin/panel-shell.tsx`, `src/app/admin/alumnos/[id]/page.tsx`, `src/admin/overview/pending-section.tsx`
- Test: `tests/unit/chat-admin-actions.test.ts`, `tests/unit/admin-shell.test.ts`, `tests/unit/admin-guards.test.ts`, `tests/e2e/chat-admin.spec.ts`

**Interfaces:**
- Consumes: Tarea 1 (`sendCoachMessage`, `listMessages`, `listInbox`, `countUnreadConversations`, `markRead`, `deleteConversation`, `notifyChatMessage`, `conversationHref`), Tarea 2 (`MessageThread`, `ComposeForm`, `AutoRefresh`, `ChatFormState`, `tests/helpers/chat-e2e.ts`).
- Produces (`actions.ts`): `sendCoachMessageAction(customerId: string, previous: ChatFormState, formData: FormData): Promise<ChatFormState>`, que suma el resultado `"no-account"` a `ChatFormState["outcome"]`; `markCoachReadAction(customerId: string): Promise<void>`; `deleteConversationAction(customerId: string): Promise<void>`.
- Produces (`unread-count.ts`): `unreadConversationsForMenu(): Promise<number>`, que verifica la sesión, y ante una falla de la base devuelve 0 sin romper la página.
- Produces (`admin-shell.tsx`): `AdminShell` acepta `badges?: Partial<Record<AdminSectionId, number>>` y muestra el número junto a la sección cuando es mayor que cero, con un texto para lectores de pantalla ("3 sin leer").

- [ ] **Step 1: Tests unitarios que fallan.**
  - Cada acción empieza por `requireAdmin()` (`admin-guards.test.ts`).
  - `sendCoachMessageAction`: guarda y devuelve `sent`; **alumno sin cuenta: `no-account` con el texto devuelto, sin fila**; id que no es UUID: `no-account`; la base tira: `failed`.
  - El aviso al alumno se programa solo con `notify: true`.
  - `AdminShell` con `badges={{ messages: 3 }}` muestra "3" y "3 sin leer" en la sección Mensajes; con 0 o sin `badges`, nada. La sección va después de "Alumnos".
- [ ] **Step 2: e2e que falla** (`tests/e2e/chat-admin.spec.ts`), con los dos lados y un alumno propio por test.
  - **Ida y vuelta:** el alumno escribe; en el panel, el menú Mensajes muestra un número de al menos 1, la bandeja tiene su fila con el comienzo del mensaje y la marca de sin leer; al abrir la conversación se ve el mensaje y, de vuelta en la bandeja, su fila ya no está sin leer. Tallami contesta; la tarjeta del portal del alumno dice "1 mensaje sin leer"; el alumno abre sus mensajes, ve la respuesta y la tarjeta vuelve a cero.
  - **Avisos:** con dos mensajes seguidos del alumno llega un solo email a Tallami con el nombre del alumno; con dos respuestas seguidas de Tallami llega un solo email al alumno. Ninguno trae el texto del mensaje. Se leen del servidor falso (`GET /test/emails`).
  - Tallami escribe primero, desde el botón "Mensajes" de la ficha de un alumno invitado, y el alumno lo ve.
  - **Un alumno cargado a mano y sin cuenta:** su conversación dice que no puede recibir mensajes, lleva a su ficha para invitarlo y no muestra el formulario.
  - `<script>alert(1)</script>` del alumno se ve como texto en la bandeja y en la conversación, y no abre ningún diálogo.
  - **Borrar la conversación:** pide confirmación; después la bandeja no tiene la fila, y la página del alumno, que estaba abierta, queda vacía en su siguiente refresco, sin error.
  - Un VOD review en vivo recién pagado aparece en "Por coordinar" con el enlace "Escribirle", que lleva a su conversación.
  - Un id de alumno que no existe muestra "No encontramos a ese alumno". Sin sesión del panel, las dos páginas mandan al ingreso.
  - `axe` sin violaciones en la bandeja y en la conversación, en celular y en pantalla ancha. A 375 px la página no se desliza de costado.
- [ ] **Step 3:** correrlos → FALLAN.
- [ ] **Step 4: Implementar.**
  - `ADMIN_SECTIONS` suma `{ id: "messages", label: "Mensajes", href: ADMIN_ROUTES.messages }` después de "Alumnos". `PanelShell` lee `unreadConversationsForMenu()` y se lo pasa a `AdminShell`.
  - Bandeja: una fila por conversación con el alumno, el comienzo del último mensaje, cuándo fue (hora de Argentina) y cuántos sin leer. Vacía: "Todavía no hay conversaciones. Podés escribirle a un alumno desde su ficha."
  - Conversación: el nombre del alumno con enlace a su ficha; con qué cuenta entra y su usuario de Discord; si recibe avisos por email o no ("Este alumno no recibe avisos por email: avisale por Discord"). `MessageThread` con `viewer="coach"` y la zona de Argentina, `ComposeForm` y `AutoRefresh` con `markCoachReadAction`.
  - Borrar: botón con confirmación, como `src/admin/site-requests/delete-site-request.tsx`, que vuelve a la bandeja con un aviso.
  - Ficha del alumno: botón "Mensajes" junto a "Volver a alumnos". "Por coordinar": enlace "Escribirle" en cada fila.
- [ ] **Step 5:** `npx vitest run`, `npx playwright test tests/e2e/chat-admin.spec.ts tests/e2e/chat-portal.spec.ts tests/e2e/admin-customers.spec.ts tests/e2e/admin-overview.spec.ts` y, con los datos de ejemplo, `npx playwright test -c playwright.demo.config.ts tests/e2e/admin-quality.spec.ts tests/e2e/admin-overview.spec.ts` → PASAN.
- [ ] **Step 6: Commit** `feat: sección Mensajes en el panel`.

### Task 4: Textos del sitio, legal, guía y corrida completa

**Files:**
- Modify: `messages/{es,pt,en}.json` (`Faq`, `HowItWorks`, `Emails.purchase`), `src/payments/emails.ts`, `src/content/legal/terms.ts`, `src/content/legal/privacy.ts`, `README.md`, `CLAUDE.md`, `tests/e2e/legal-pages.spec.ts`, `tests/unit/legal-content.test.ts`, `tests/unit/payments-emails.test.ts`, `tests/unit/messages.test.ts`
- Test: los mismos

- [ ] **Step 1: Tests que fallan.**
  - `legal-pages.spec.ts`: las preguntas frecuentes de `/es` traen los dos textos nuevos de abajo.
  - `payments-emails.test.ts`: el email de confirmación de compra trae `{SITE_URL}/{locale}/portal/mensajes`.
  - `legal-content.test.ts`: privacidad en español nombra los mensajes, que los leen solo el alumno y Tallami, y los 24 meses; términos nombra el chat del portal. Los tres idiomas siguen con las mismas secciones y la misma cantidad de párrafos. Sigue sin haber emails, CUIT ni dirección.
- [ ] **Step 2:** correrlos → FALLAN.
- [ ] **Step 3: Textos, en español** (traducir a pt y en):
  - `Faq.items.afterPayment.answer`: "Te escribo por el chat de tu portal para coordinar. Todo lo que te entrego queda guardado ahí."
  - `Faq.items.schedule.answer`: "Coordinamos día y hora por el chat de tu portal. Para hablar en vivo te paso mi Discord."
  - `HowItWorks.steps.schedule.body`: "Si es un VOD offline, pegás tus códigos de replay en el portal. Si es en vivo, arreglamos día y hora por el chat."
  - `Emails.purchase.chat`: "Para coordinar, escribime por el chat de tu portal: {url}". Va después de la línea del portal.
- [ ] **Step 4: Legal, en los tres idiomas**, sumando párrafos a secciones que ya existen y cambiando `updatedOn`:
  - Términos, "Entrega": las sesiones en vivo y todo lo que haga falta se coordinan por el chat del portal; para hablar en vivo, Tallami pasa su Discord por ahí.
  - Privacidad, "Tu ficha de alumno, tus compras y tus entregas": los mensajes que el alumno y Tallami se escriben en el portal se guardan para coordinar el servicio, y los leen solo ellos dos. Cuando alguno escribe, al otro le llega un aviso por email que no trae el texto del mensaje.
  - Privacidad, "Cuánto tiempo se guarda": una conversación sin mensajes nuevos durante 24 meses se borra sola, y se puede pedir que se borre antes desde el formulario de contacto.
  - Privacidad, "Menores de edad": el chat es solo para coordinar el servicio.
- [ ] **Step 5: README y CLAUDE.md.**
  - README, sección nueva "Mensajes" después de "Portal del alumno": quién puede escribir, dónde lo ve cada uno, los avisos por email y cuándo no salen, el tope de 30 por hora, que no es en tiempo real, borrar una conversación, y la migración 0009 (`npm run db:migrate` antes de desplegar). Sumar los mensajes a "Qué se guarda de cada alumno".
  - `CLAUDE.md`, párrafo "Pagos": "Lo demás se coordina por mensaje" pasa a "Lo demás se coordina por el chat del portal".
- [ ] **Step 6:** `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` y `npm run test:e2e` → PASAN los tres servidores.
- [ ] **Step 7: Commit** `feat: el sitio y los textos legales hablan del chat del portal`.
