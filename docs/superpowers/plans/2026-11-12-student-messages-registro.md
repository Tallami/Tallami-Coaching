# Mensajes entre el alumno y Tallami: decisiones y pendientes menores

Registro de la ejecución del plan `2026-11-12-student-messages.md` (rama `feat/student-messages`, 12 y 13 de noviembre de 2026). Son las decisiones que se tomaron sin consultar a Tallami, cada una con lo que cuesta si está mal, y los hallazgos menores que las revisiones dejaron para más adelante. Las líneas están como se anotaron durante el trabajo, en inglés.

Lo que decidió el diseño (quién puede escribir, una conversación por alumno, solo texto, avisos sin el texto del mensaje, 24 meses) está en `docs/superpowers/specs/2026-11-12-student-messages-design.md`.

## Decisiones

- `ChatFormState` lives in `src/chat/form-state.ts` (created in Task 2) and already includes `no-account` in its outcomes; both action files import it — a "use server" file should export only async functions and Task 3 does not list Task 2's file — if wrong: nothing functional, one more small file.
- the actions show a `duplicate` send as sent (box emptied, no second email) — the message is already saved, and telling the person it failed would make them send it a third time — if wrong: someone who really wants the same line twice within 10 seconds sees it once.
- each send checks that the student exists (and, for Tallami, that a portal account is linked) inside the transaction, before creating the conversation — the plan's tests require `invalid` / `no-account` and no rows — if wrong: one extra read per message.
- e2e tests that depend on the 20-second refresh advance time with Playwright's clock or poll with a generous timeout, never a fixed wait — the project's rule against timing-based assertions — if wrong: those tests take up to ~20 s each.
- the student's messages page renders whole on each request (`export const instant = false`, as global-not-found does) instead of the portal's Suspense pattern the plan named — the spec requires the form to work without JavaScript, and under cacheComponents content inside Suspense only appears through an inline script — if wrong: no loading placeholder, and the first byte waits for the session and the messages.
- C1 is fixed by keeping the unsent text in the tab's sessionStorage, tied to its owner (the student, or admin + student), restored on mount and cleared when the message is sent — the reviewer's recommendation, and the only way the text survives a view that replaces the form — if wrong: an unsent draft stays in that browser tab until it is sent, overwritten or the tab closes.
- M1 — only the count reset in AutoRefresh is fixed now (a conversation deleted and written again while the page stays open); read marks keep using the server's time instead of the newest message on screen — the window is under a second and corrects itself the next time the page opens — if wrong: a message arriving in the instant the page opens can show as already read.
- M4 — a failed unread count no longer fails the portal page; the card shows without a number — purchases matter more than the count — if wrong: a database failure there is visible only in the logs.
- M3 (textarea counts UTF-16 units, server counts characters), M5 (millisecond race between the coach's account check and an unlink), M6 (an unlinked account is told its session ended), M8 (no limit on messages per page or inbox rows) and M9 (the hourly-limit notice does not say how long to wait) stay as they are — each is rare or harmless at this scale — if wrong: emoji-heavy text stops near 1,000 emoji; one message can reach a just-unlinked student; an unlinked student reads a slightly wrong notice; a very long conversation renders whole; a student over the limit does not know when to retry.
- while Tallami keeps a conversation open and visible, each refresh marks it read, so student messages more than 20 seconds apart each send him an email — it is what the design says ("cada vez que llegan mensajes nuevos con la pestaña a la vista") and is capped by the student's 30 per hour — if wrong: extra emails while he has the conversation on screen.
- the SQL names `messages` and `conversations` without a schema, like every other table Drizzle queries — Supabase's default search_path resolves them to `public` (its own `realtime.messages` is not on the path) — if wrong: the unread queries would fail in production and the e2e against real Postgres would show it at the first deploy.

## Lo que no se probó de verdad

- "Dos mensajes a la vez mandan un solo email" se apoya en el bloqueo de la fila de la conversación: PGlite usa una sola conexión, así que no hay una prueba con dos conexiones de Postgres (igual que en los pagos).
- `export const instant = false` en la página de mensajes del alumno está probado por los e2e (sin JavaScript y sin caché), no por documentación de Next.
- Los emails se probaron contra el servidor falso de Resend, no contra Resend.

## Pendientes menores

- chat-emails.test.ts — the pt test only checks the subject is not the Spanish one; assert the exact Portuguese subject and add an en case.
- chat-conversations.test.ts — "a message from one side does not change the other side's notify" is tested in one direction only.
- listInbox loads every conversation and sorts in memory; fine at this scale, could be ordered in SQL.
- compose-form.tsx — the "sent" status is identical on consecutive sends (not re-announced) and stays in the DOM.
- compose-form.tsx — scrollIntoView on mount jumps past the page heading on short screens; also applies in the panel.
- message-thread.tsx — role="list" on an <ol> is redundant.
- axe runs only on a page with messages and no error state; signed-out / invalid alert states are not scanned.
- delete-conversation.tsx — after "No, conservarla" focus falls to body; return it to the "Borrar" button.
- the menu number still counts the conversation just opened until the next refresh (count is read before the mark).
- admin-quality.spec.ts Tab-order test compares exact menu names; "Mensajes N sin leer" would break it on a server with unread conversations (it runs only on the demo server, which has none). Strip the suffix or match by prefix.
- services-page.test.ts mocks PanelShell as a passthrough (async component under renderToStaticMarkup).
- the "no email on the account" warning is covered by a unit render test only.
- privacy.ts new "ficha" paragraph — "cuando uno escribe, al otro le llega un aviso" omits that only the first unread message sends one and none goes out if the account has no email (es/pt/en).
- messages.test.ts new test only checks `{url}` is present; legal-content tests check the new content in es only.
- the panel's "Salir" does not clear the chat draft slot in sessionStorage (restored only for the same admin + student key).
- two consecutive "sent" results are announced once to screen readers.
- (revisión final, M1) la marca de leído usa la hora del servidor y no el último mensaje que estaba en pantalla: un mensaje que llega en el instante en que se abre la página puede quedar como leído sin haberse visto.
- (revisión final, M3) el cuadro de texto cuenta unidades UTF-16 y el servidor caracteres: un texto lleno de emojis se corta cerca de los 1.000.
- (revisión final, M5) carrera de milisegundos entre el control de cuenta vinculada y una desvinculación: un mensaje de Tallami puede entrar justo después.
- (revisión final, M6) a una cuenta que Tallami desvincula se le dice "tu sesión se cerró"; un aviso propio sería más claro.
- (revisión final, M8) la conversación y la bandeja se muestran enteras, sin tope ni "ver anteriores".
- (revisión final, M9) el aviso del tope de 30 por hora no dice cuánto esperar.
