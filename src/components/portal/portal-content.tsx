import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import type { PortalAccount } from "@/portal/accounts";
import { enabledProviders, isPortalConfigured } from "@/portal/config";
import { getCurrentStudent } from "@/portal/current";
import { parsePortalQuery, portalNotice, type PortalView } from "@/portal/page-state";
import { listStudentPurchases, type StudentPurchase } from "@/portal/purchases";
import { AccountBar } from "./account-bar";
import { MessageView } from "./message-view";
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
  | { view: "signedOut" }
  | { view: "unlinked"; account: PortalAccount }
  | { view: "linked"; account: PortalAccount; purchases: StudentPurchase[] };

/**
 * Lee la sesión y, si la cuenta es de un alumno, sus compras. Es la única puerta a los datos del
 * portal de esta página: sin sesión (o con una que no vale) no se abre ninguna consulta de compras, y
 * las compras que se piden son siempre las del alumno de esa cuenta.
 */
async function loadVisitor(): Promise<Visitor> {
  const account = await getCurrentStudent();
  if (!account) return { view: "signedOut" };
  if (!account.customerId) return { view: "unlinked", account };
  const purchases = await listStudentPurchases(await getDb(), account.customerId);
  return { view: "linked", account, purchases };
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

  let visitor: Visitor;
  try {
    visitor = await loadVisitor();
  } catch (error) {
    // Las señales internas de Next (por ejemplo, esperar a que haya un pedido) no son fallas.
    unstable_rethrow(error);
    console.error(`Portal: no se pudo leer la sesión o las compras del alumno. ${errorName(error)}`);
    return <MessageView messageKey="loadFailed" />;
  }

  const view: PortalView = visitor.view;
  const notice = portalNotice(query, view);

  return (
    <>
      {/* El token ya está en los botones de ingreso: se saca de la barra de direcciones. */}
      {query.inviteToken ? <StripInviteFromUrl /> : null}
      {notice ? <PortalNotice notice={notice} /> : null}
      {visitor.view === "signedOut" ? (
        <SignInView providers={enabledProviders()} locale={locale} inviteToken={query.inviteToken} />
      ) : (
        <>
          <AccountBar account={visitor.account} locale={locale} />
          {visitor.view === "unlinked" ? (
            <UnlinkedView providers={enabledProviders()} locale={locale} inviteToken={query.inviteToken} />
          ) : (
            <PurchaseList purchases={visitor.purchases} />
          )}
        </>
      )}
    </>
  );
}
