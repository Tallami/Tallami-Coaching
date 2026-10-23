import type { ReactNode } from "react";
import type { AlertStatus } from "@/admin/alerts/config";
import type { Passkey } from "@/admin/auth/passkeys";
import type { AdminSession } from "@/admin/auth/sessions";
import { formatMoment } from "@/admin/dates";
import { AddPasskey } from "./add-passkey";
import { CloseAllSessions } from "./close-all-sessions";
import { EnrollmentCode } from "./enrollment-code";
import { PasskeyList, type PasskeyRow } from "./passkey-list";
import { SessionList, type SessionRow } from "./session-list";

interface SecurityViewProps {
  passkeys: Passkey[];
  /** Las sesiones abiertas (la actual incluida). */
  sessions: AdminSession[];
  /** El id de la sesión de este navegador. */
  currentSessionId: string;
  /** El nombre propuesto para la llave de este dispositivo ("Chrome en Windows"). */
  defaultKeyName: string;
  /** El origen configurado de las llaves (`getWebAuthnConfig().origin`), para el aviso de "otra dirección". */
  origin: string;
  /** El estado de los avisos por email (`getAlertStatus()`). */
  alerts: AlertStatus;
}

function toPasskeyRow(passkey: Passkey): PasskeyRow {
  return {
    id: passkey.id,
    name: passkey.name,
    createdAt: formatMoment(passkey.createdAt),
    lastUsedAt: passkey.lastUsedAt ? formatMoment(passkey.lastUsedAt) : null,
  };
}

function toSessionRow(session: AdminSession, currentSessionId: string): SessionRow {
  return {
    id: session.id,
    device: session.device,
    startedAt: formatMoment(session.createdAt),
    lastSeenAt: formatMoment(session.lastSeenAt),
    isCurrent: session.id === currentSessionId,
  };
}

/**
 * El estado de los avisos por email: sin configurar (faltan variables), con una variable
 * mal escrita (se dice cuál, nunca su valor) o activos. Con la dirección de prueba de
 * Resend avisa a quién le llegan.
 */
function AlertsStatus({ alerts }: { alerts: AlertStatus }) {
  if (alerts.kind === "off") return <p className="font-bold">Avisos por email: sin configurar</p>;
  if (alerts.kind === "invalid") {
    return (
      <>
        <p className="font-bold">Avisos por email: configuración inválida</p>
        <p className="mt-2 text-[0.875rem] leading-snug text-ink-2">
          {`Revisá la variable ${alerts.variable}: no es una dirección de email. Mientras tanto no se manda ningún aviso.`}
        </p>
      </>
    );
  }
  return (
    <>
      <p className="font-bold">{`Avisos por email: activos (a ${alerts.maskedEmail})`}</p>
      {alerts.usesTestSender ? (
        <p className="mt-2 text-[0.875rem] leading-snug text-ink-2">
          Salen de la dirección de prueba de Resend, que solo entrega al email de tu cuenta de Resend. Para avisar a
          otra dirección hace falta verificar un dominio propio en Resend.
        </p>
      ) : null}
    </>
  );
}

interface SecuritySectionProps {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}

/** Cada bloque de la página: un título a la izquierda y su contenido a la derecha (arriba y abajo en el celular). */
function SecuritySection({ id, title, description, children }: SecuritySectionProps) {
  return (
    <section
      aria-labelledby={id}
      className="grid grid-cols-[13rem_minmax(0,1fr)] gap-x-10 gap-y-4 border-2 border-ink bg-white px-6 py-7 narrow:grid-cols-1 narrow:px-5 narrow:py-6"
    >
      <div>
        <h2 id={id} className="text-[1.375rem] leading-tight font-extrabold [font-stretch:75%]">
          {title}
        </h2>
        <p className="mt-1 text-[0.875rem] leading-snug text-ink-2">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * El cuerpo de Configuración → Seguridad (el encabezado lo pone la página): las llaves
 * de acceso con agregar, renombrar y borrar; el código para registrar otro dispositivo;
 * las sesiones abiertas con "Cerrar todas"; y el estado de los avisos por email (a qué
 * dirección van, enmascarada; que no están configurados; o qué variable está mal).
 *
 * De una llave no se muestra si es la de este dispositivo: el panel no puede saberlo
 * (la llave puede venir del celular por código QR).
 */
export function SecurityView({
  passkeys,
  sessions,
  currentSessionId,
  defaultKeyName,
  origin,
  alerts,
}: SecurityViewProps) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SecuritySection
        id="security-passkeys"
        title="Llaves de acceso"
        description="Con la contraseña sola no se entra: hace falta además una de estas llaves."
      >
        <PasskeyList passkeys={passkeys.map(toPasskeyRow)} origin={origin} />
        <div className="mt-5 border-t border-rule pt-5">
          <AddPasskey defaultName={defaultKeyName} origin={origin} />
        </div>
      </SecuritySection>

      <SecuritySection
        id="security-code"
        title="Código para otro dispositivo"
        description="Para registrar la llave de un dispositivo que no puede usar la de otro, como una PC sin Bluetooth."
      >
        <ol className="mb-5 list-decimal space-y-1 pl-5 text-[0.9375rem] leading-snug text-ink-2">
          <li>Generá el código acá.</li>
          <li>En el dispositivo nuevo, ingresá con tu contraseña y tocá «Tengo un código».</li>
          <li>Escribí el código y registrá la llave de ese dispositivo.</li>
        </ol>
        <EnrollmentCode origin={origin} />
      </SecuritySection>

      <SecuritySection
        id="security-sessions"
        title="Sesiones abiertas"
        description="Se cierran solas a los 30 minutos sin uso, y a las 8 horas como máximo."
      >
        <SessionList sessions={sessions.map((session) => toSessionRow(session, currentSessionId))} />
        <div className="mt-5 border-t border-rule pt-5">
          <CloseAllSessions origin={origin} />
        </div>
      </SecuritySection>

      <SecuritySection
        id="security-alerts"
        title="Avisos por email"
        description="Un email por cada ingreso y por cada cambio de seguridad del panel."
      >
        <AlertsStatus alerts={alerts} />
      </SecuritySection>
    </div>
  );
}
