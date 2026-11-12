# Pagos con Mercado Pago: decisiones y pendientes menores

Registro de la ejecución del plan `2026-11-04-payments-mercadopago.md` (ramas y revisiones de noviembre de 2026). Son las decisiones que se tomaron sin consultar a Tallami, cada una con lo que cuesta si está mal, y los hallazgos menores que las revisiones dejaron para más adelante. Las líneas están como se anotaron durante el trabajo, algunas en inglés.

## Decisiones

- e2e "Valor cambiado" no cambia el valor global: altera el campo oculto `shownArsMinor` en la página y comprueba `price-changed`; el cambio real del valor lo cubre el unitario de `startCheckout`. Cualquier e2e que necesite valor usa un ayudante que guarda 1500, siempre el mismo — el servidor e2e es compartido y paralelo, y otro valor rompería pruebas vecinas — si está mal, la prueba e2e cubre un poco menos del camino real, y el unitario sigue cubriendo la regla.
- T1 suma un unitario de render del precio con `rate` null que solo muestra dólares — el plan lo pide y no lo probaba — si está mal, sobra una prueba.
- si guardar el valor hace flaquear "still prerendered", esa prueba espera con `expect.poll` a que la respuesta sea HIT o STALE; no se relaja lo que afirma — sigue exigiendo prerender y `s-maxage` — si está mal, la prueba tarda un poco más.
- los enlaces a páginas de tareas siguientes pueden dar 404 dentro de la rama, y ningún e2e navega a ellos antes de su tarea; la rama se integra entera — si está mal, un commit intermedio tiene un enlace roto que nunca llega a main.
- la navegación del panel se suma donde esté de verdad (`src/admin/ui/sections.ts` o `admin-shell.tsx`), aunque el plan nombre solo `admin-shell.tsx` — el implementador lo verifica leyendo — si está mal, un enlace queda en otro archivo equivalente.
- the rate is stored as {rate} instead of a bare string — Drizzle JSON.parses jsonb strings, so 1500.5000 came back as a number — if wrong, one read/write pair changes in pricing.ts.
- an approved payment with approvedAt null takes paidOn from now — date_approved can be missing or malformed and the sale must still exist — if wrong, paidOn is off by the delay between approval and processing.
- a different payment id on an already approved order is mismatch only if that payment took money (approved, partially_refunded, refunded, in_mediation, charged_back); a late rejected, cancelled or pending attempt is no-change without email — one preference can have several attempts and the false alarm teaches Tallami to ignore the real one — if wrong, a stray pending payment that later gets approved is still caught when its approved notice arrives.
- a second partial refund on one payment gives no-change with no note or email — ProviderPayment has no refunded amount and MP keeps the history — if wrong, Tallami sees only the first partial refund in the panel and the rest in Mercado Pago.
- repeated in_mediation notices re-send the email to Tallami — nowhere to record it, and a repeated alert about a dispute is the safe side — if wrong, a few duplicate emails.
- PGlite serializes transactions, so concurrency rests on the SQL-log test of the locks plus Postgres semantics, not on a two-connection run — no real Postgres is available in tests — if wrong, a double notice at the same instant in production could race; the lock design makes that unlikely, and the final review looks at it again.
- unknown-order sends no email, only a log line — other payments on the same Mercado Pago account (a QR sale, say) reach this webhook and would be false alarms — if wrong, a payment with a tampered reference goes unnoticed in email but stays in Mercado Pago and in the log.
- partially_refunded, in_mediation and charged_back with no sale create the sale — the design rejects an approved payment that never reaches the panel — if wrong, a sale appears from a late notice, which Tallami can see and correct.
- with JavaScript fully off the purchase screen shows a noscript note, because Suspense content needs JS to appear; the form works before hydration or with the site bundles blocked — the plan asked for both Suspense and a no-JS form and the static shell matters more — if wrong, a buyer with JS fully off must enable it, and Mercado Pago itself needs JS anyway.
- /es/comprar/no-existe uses a beforeFiles rewrite to give a real 404, because notFound() answers 200 under Cache Components — if wrong, one rule in next.config.ts needs revisiting when Next changes that behavior.
- the retry link on the waiting notice shows only for orders with status created; a pending order (real payment in progress, including in_process) shows only the waiting text — a second attempt there could charge twice with nothing flagging it, since the double-charge alarm works within one order — if wrong, a buyer whose payment is stuck in review waits without a shortcut, and can still use the service button on the home.
- the student sees the sale dueAt when set, so a date Tallami edits is the one the student sees — the panel is the source of truth for deadlines — if wrong, the student sees a date Tallami moved without a note.
- the buyer confirmation email for VOD reviews gets one extra line pointing to the replay-codes field — the codes start the 72 or 96 hours and buyers must know where they go — if wrong, one line to drop.
- a Temporada Pro link is single-use at payment time only; two people paying the same link both get a sale — Tallami sends each link to one person, and blocking open orders would strand a buyer who abandoned the first attempt — if wrong, Tallami refunds one of two real payments in Mercado Pago.
- payment links accept whole dollars only — the purchase screen shows USD without decimals — if wrong, Tallami cannot set an amount with cents.
- the withdrawal and cancellation forms take an optional "Compra" (order reference) field — the design asks what was bought, optionally by order number — if wrong, one optional field to drop.
- privacy says the site runs in the Sao Paulo region, which holds only with Vercel Function Region gru1, as the README asks — it is the planned deployment — if wrong, one sentence in privacy.ts in three languages.
- the duplicate-student guide says move the sale, unlink, invite from the original, and leave the duplicate in the list — the panel cannot delete a student with history — if wrong, the list shows one extra student.
- a VOD sale with a due date and no codes is not waiting for codes: the panel shows its date, the portal shows no codes field, and a submit is closed — a date Tallami set means he has what he needs, and the panel is the source of truth for deadlines — if wrong, a web buyer whose sale Tallami dated by hand before the codes arrived must send them by message.
- the site cannot take payments without ADMIN_ALERT_EMAIL and the portal configured — every sale and every problem reaches Tallami by email, so a site that cannot email him must not charge — if wrong, one more variable to set before go-live, which the README already asks for.
- the site-wide cap on public forms counts per kind, and a form over its cap is still refused — saving over the cap would allow unbounded writes — if wrong, a flood aimed at the withdrawal form itself can still block it for an hour.
- pending orders older than 90 days are deleted with the other unpaid ones — the privacy page promises it and no card payment stays pending that long — if wrong, an approval arriving after 90 days would find no order and create no sale.

## Pendientes menores

- Task 1: payments-prices e2e "saves nothing" only asserts URL and message; unit tests cover the no-write case
- Task 1: price-pair siblings read as one run by a screen reader; consider a hidden separator
- Task 1: settings-view ReactNode import out of order
- Task 1: invalid rate shows a generic message and drops the parseRateInput text
- Task 1: in the Temporada Pro card the "por equipo" unit sits between the USD and ARS prices; it should go under both (price-pair.tsx)
- Task 2: webhook signature has no ts freshness window; mitigated because status is always re-fetched and processing is idempotent
- Task 2: warn-once flag in mercadopago.ts test is module state and the warning is not asserted
- Task 2: site_requests and pro_applications have no created_at index for the 24-month sweep; negligible at this volume
- Task 3: apply.ts comment says the account lock does not block key share, but updating customer_id takes FOR UPDATE strength; a rare safe deadlock with redeemInvite aborts one side (MP retries, or the login is retried)
- Task 3: mismatch email omits the sale payment id and shows the order amount without saying so
- Task 3: emails.ts texts "La venta no cambió" and "sigue cobrada" are false when the sale was just created
- Task 3: emails.ts builds the buyer message after Tallami send started; unreachable throw today
- Task 3: webhook.ts imports readLimitedText from the interest endpoint, pulling its module graph; move it to src/lib
- Task 3: a failing apply logs only the error type; log the order id once it is a valid uuid
- Task 3: repeated-mediation ruling and the sale lock have no direct test
- Task 3: small duplication (createSale + saveOrder three times, errorName one-liner three times), emails.ts default lets a new outcome go silent
- Task 4: checkout-summary paymentNote depends on rate, not canPay, so it can sit beside "todavía no se puede pagar"
- Task 4: availability does not include isPortalConfigured, so the panel can say ready while buyers see unavailable
- Task 4: the beforeFiles rewrite is case-insensitive; /es/comprar/VOD-TORNEO answers the not-found screen with status 200
- Task 4: a buyer returning from Mercado Pago signed out signs in to /portal with no notice; a failed sign-in from the purchase screen also lands on the portal; only the webhook remains in those cases
- Task 4: small duplication: first() three times, PAYMENT_ID twice, CATALOGS verbatim in checkout.ts and emails.ts
- Task 4: the buy action has no rate limit, so a signed-in account can create many orders and Mercado Pago preferences; user security rule asks for limits on endpoints
- Task 4: a buyer with a payment in progress can still start a new order from the home; two approved payments would be two sales with nothing flagging it. A second purchase is also legitimate, so nothing blocks it
- Task 4: accountOrderState reads all of an unlinked account orders with no row limit
- Task 5: pending.ts comment for MULTI_SESSION_ITEMS stranded above the new constants
- Task 5: a manual VOD sale with a due date, no codes and overdue shows "faltan los códigos" instead of "venció"; the overdue signal is lost
- Task 5: replayState shows "sent" with a deadline on a refunded or cancelled sale
- Task 5: checkout-replay e2e written after the code, no RED run
- Task 5: purchases.ts casts replayRows.get(...) as PurchaseRow
- Task 6: the delete-application test order is not tied to the link, so ON DELETE SET NULL on orders.pro_payment_link_id is not exercised
- Task 6: delete-application.tsx leaves busy stuck if the action throws
- Task 6: checkout.ts casts item as ServiceId for priceUsdMinor; applications page casts status unchecked
- Task 6: with the database down while reading a link, the buyer sees "link does not work" instead of a temporary error
- Task 6: "Cobrado" on the application sums paid links and does not drop on a later refund
- Task 7: KIND_LABELS duplicated in site-requests/emails.ts and admin/pedidos/page.tsx; form LIMITS copied by hand from SITE_REQUEST_LIMITS
- Task 7: (forms)/actions.ts casts the input object instead of typing it
- Task 7: clean() strips NUL but not CR/LF, and name goes into the email subject to Tallami
- Task 7: delete-site-request busy never resets on throw; markSiteRequestHandled overwrites handledAt on repeat
- Task 7: messages json re-serialization churn in unrelated Portal blocks
- Task 7: listSiteRequests unbounded, no pagination
- Task 7: a receipt email goes to whatever address the visitor types; bounded by 5 per hour per connection and 100 per hour site-wide
- Task 8: Pro form privacy link is a plain anchor in the same tab, typed data can be lost on Back
- Task 8: legal-page.tsx keys paragraphs by text
- Task 8: checkout-legal.tsx keeps its own copy of the three legal paths instead of LEGAL_PAGES
- Final: the Temporada Pro page intro repeats almost the same sentence twice (the page lead and the Services pro.description)
- Final: the mismatch log fires only from the webhook path, not from the portal fallback check; the webhook for the same payment logs it
- Final: guard.ts header comment still says site requests come later
- Final: tests/unit/seed-demo-clear.test.ts can time out at 30 s when the whole suite runs under load
