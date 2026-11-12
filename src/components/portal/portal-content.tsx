import { unstable_rethrow } from "next/navigation";
import { after, connection } from "next/server";
import { unreadForStudent } from "@/chat/conversations";
import { SERVICES, bookingHref } from "@/content/services";
import { getDb, type Db } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { isSettled } from "@/payments/apply";
import { reconcileOrder } from "@/payments/checkout";
import { getMercadoPagoClient } from "@/payments/mercadopago";
import { accountOrderState, orderForAccount, orderProgress, type AccountOrderState, type Order } from "@/payments/orders";
import { getAccount, type PortalAccount } from "@/portal/accounts";
import { enabledProviders, isPortalConfigured } from "@/portal/config";
import { getCurrentStudent } from "@/portal/current";
import { parsePortalQuery, portalNotice, type NoticeKey, type PortalQuery, type PortalView } from "@/portal/page-state";
import { listStudentPurchases, type StudentPurchase } from "@/portal/purchases";
import { AccountBar } from "./account-bar";
import { MessageView } from "./message-view";
import { MessagesCard } from "./messages-card";
import { PortalNotice } from "./portal-notice";
import { PurchaseList } from "./purchase-list";
import { SignInView } from "./sign-in-view";
import { StripInviteFromUrl } from "./strip-invite-from-url";
import { UnlinkedView } from "./unlinked-view";

interface PortalContentProps {
  locale: Locale;
  /** Los parámetros de la dirección, sin esperar: leerlos vuelve dinámico a todo lo que sigue. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Lo que se sabe de quien mira la página: sin sesión, cuenta sin vincular o alumno con sus compras. */
type Visitor =
  | { view: "signedOut"; order: null }
  | { view: "unlinked"; account: PortalAccount; order: Order | null; orderState: AccountOrderState }
  | { view: "linked"; account: PortalAccount; order: Order | null; purchases: StudentPurchase[]; unread: number };

/**
 * El pedido con el que volvió de pagar, solo si es de esta cuenta. Si todavía no se confirmó, se consulta
 * el pago una vez, por si el aviso de Mercado Pago no llegó, y se devuelve cómo quedó. Los emails de esa
 * consulta salen después de responder.
 */
async function returningOrder(db: Db, account: PortalAccount, query: PortalQuery, now: Date): Promise<Order | null> {
  if (!query.orderId) return null;
  const order = await orderForAccount(db, query.orderId, account.id);
  if (!order || isSettled(order)) return order;
  const client = getMercadoPagoClient();
  if (!client) return order;
  await reconcileOrder(db, client, order, query.paymentId, now, (task) => after(task));
  return orderForAccount(db, order.id, account.id);
}

/**
 * Lo que le dice la vista a una cuenta sin vincular. Manda el pedido con el que volvió, que es del que
 * habla el aviso de arriba: los dos textos no pueden decir cosas distintas. Sin él, los pedidos de la cuenta.
 */
async function unlinkedOrderState(db: Db, accountId: string, order: Order | null, now: Date): Promise<AccountOrderState> {
  const progress = order ? orderProgress(order, now) : null;
  return progress === "unconfirmed" || progress === "failed" ? progress : accountOrderState(db, accountId, now);
}

/**
 * Lee la sesión y, si la cuenta es de un alumno, sus compras y cuántos mensajes de Tallami no leyó
 * (la tarjeta de los mensajes). Es la única puerta a los datos del
 * portal de esta página: sin sesión (o con una que no vale) no se abre ninguna consulta de compras, y
 * las compras que se piden son siempre las del alumno de esa cuenta.
 *
 * El pago que se confirma al volver puede crear el alumno y vincular la cuenta: por eso, si hubo un
 * pedido, la cuenta se lee de nuevo.
 */
async function loadVisitor(query: PortalQuery, now: Date): Promise<Visitor> {
  const signedIn = await getCurrentStudent();
  if (!signedIn) return { view: "signedOut", order: null };
  const db = await getDb();
  const order = await returningOrder(db, signedIn, query, now);
  const account = order ? ((await getAccount(db, signedIn.id)) ?? signedIn) : signedIn;
  if (!account.customerId) {
    return { view: "unlinked", account, order, orderState: await unlinkedOrderState(db, account.id, order, now) };
  }
  const [purchases, unread] = await Promise.all([
    listStudentPurchases(db, account.customerId),
    unreadForStudent(db, account.customerId),
  ]);
  return { view: "linked", account, order, purchases, unread };
}

/**
 * ¿Este aviso ofrece volver a la pantalla de compra? Si el pago falló, sí. Si se está esperando, solo mientras
 * no se vio ningún pago: quizás no llegó a pagar. Con un pago en curso (`pending`, también el `in_process` de
 * Mercado Pago) no: pagar de nuevo sería otro pedido, y si se aprueban los dos serían dos cobros. Tampoco si
 * volvió con un `payment_id`: acaba de pagar, aunque la consulta haya fallado y el aviso todavía no llegara.
 */
function offersRetry(key: NoticeKey, order: Order | null, query: PortalQuery): boolean {
  if (key === "paymentFailed") return true;
  return key === "paymentPending" && order?.status === "created" && query.paymentId === null;
}

/** La pantalla para intentar de nuevo, si es un servicio que se compra solo: Temporada Pro va con su propio link. */
function retryHrefFor(order: Order | null, locale: Locale): string | undefined {
  const service = SERVICES.find(({ id }) => id === order?.item);
  return service ? bookingHref(service.id, locale) : undefined;
}

/** Solo el nombre del error: el mensaje podría traer la conexión a la base. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Lo que cambia en cada pedido de la página del portal: depende de la dirección y de la cookie de
 * sesión. Va dentro de un `Suspense`, así el resto de la página (el encabezado, el título, el pie)
 * sale en el primer envío. Primero lee la dirección: hasta que la lee, el build prerenderiza.
 *
 * `connection()` corta además la precarga: Next también arma la página cuando el navegador la precarga
 * desde un link (con las cookies), y ahí la hora (`new Date()` de la sesión) no puede leerse. Lo que
 * es de una persona se arma solo cuando esa persona abre la página, nunca en una precarga.
 */
export async function PortalContent({ locale, searchParams }: PortalContentProps) {
  const query = parsePortalQuery(await searchParams);
  await connection();
  if (!isPortalConfigured()) return <MessageView messageKey="unavailable" />;

  const now = new Date();
  let visitor: Visitor;
  try {
    visitor = await loadVisitor(query, now);
  } catch (error) {
    // Las señales internas de Next (por ejemplo, esperar a que haya un pedido) no son fallas.
    unstable_rethrow(error);
    console.error(`Portal: no se pudo leer la sesión o las compras del alumno. ${errorName(error)}`);
    return <MessageView messageKey="loadFailed" />;
  }

  const view: PortalView = visitor.view;
  const notice = portalNotice(query, view, visitor.order ? orderProgress(visitor.order, now) : null);

  return (
    <>
      {/* El token ya está en los botones de ingreso: se saca de la barra de direcciones. */}
      {query.inviteToken ? <StripInviteFromUrl /> : null}
      {notice ? (
        <PortalNotice
          notice={notice}
          retryHref={offersRetry(notice.key, visitor.order, query) ? retryHrefFor(visitor.order, locale) : undefined}
        />
      ) : null}
      {visitor.view === "signedOut" ? (
        <SignInView providers={enabledProviders()} locale={locale} inviteToken={query.inviteToken} />
      ) : (
        <>
          <AccountBar account={visitor.account} locale={locale} />
          {visitor.view === "unlinked" ? (
            <UnlinkedView
              providers={enabledProviders()}
              locale={locale}
              inviteToken={query.inviteToken}
              orderState={visitor.orderState}
            />
          ) : (
            <>
              <MessagesCard unread={visitor.unread} locale={locale} />
              <PurchaseList purchases={visitor.purchases} />
            </>
          )}
        </>
      )}
    </>
  );
}
