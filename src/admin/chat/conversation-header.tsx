import Link from "next/link";
import { studentHref } from "@/admin/routes";
import { Notice } from "@/admin/ui/notice";
import type { PortalAccount } from "@/portal/accounts";

const PROVIDER_NAMES: Record<PortalAccount["provider"], string> = { discord: "Discord", google: "Google", test: "prueba" };

interface ConversationHeaderProps {
  customerId: string;
  studentName: string;
  /** La cuenta del portal vinculada al alumno, o `null` si no tiene. */
  account: Pick<PortalAccount, "provider" | "displayName" | "handle" | "email"> | null;
}

/**
 * Quién es el alumno de la conversación y qué se sabe de cómo recibe los mensajes: con qué cuenta entra,
 * su usuario de Discord, si le llegan avisos por email, o que no puede recibir mensajes si no tiene cuenta.
 * No muestra el email: el panel solo dice si hay.
 */
export function ConversationHeader({ customerId, studentName, account }: ConversationHeaderProps) {
  return (
    <section aria-label="Datos del alumno" className="mb-6 flex flex-col gap-3">
      <p className="m-0">
        <Link
          href={studentHref(customerId)}
          prefetch={false}
          className="rounded-[2px] text-[1.125rem] font-bold underline decoration-ink-2/50 underline-offset-4 [overflow-wrap:anywhere] hover:decoration-ink"
        >
          {studentName}
          <span className="sr-only">: ver su ficha</span>
        </Link>
      </p>
      {account ? (
        <>
          <p className="m-0 text-ink-2">
            Entra con una cuenta de {PROVIDER_NAMES[account.provider]} ({account.displayName})
            {account.handle ? <>. Usuario de Discord: <strong className="text-ink">{account.handle}</strong></> : null}
          </p>
          {account.email ? null : (
            <Notice tone="warn">Este alumno no recibe avisos por email: avisale por Discord.</Notice>
          )}
        </>
      ) : (
        <Notice tone="warn">
          Este alumno no puede recibir mensajes: todavía no tiene una cuenta del portal vinculada y nadie leería lo que escribas.{" "}
          <Link href={studentHref(customerId)} prefetch={false} className="font-bold underline underline-offset-2">
            Invitarlo desde su ficha
          </Link>
        </Notice>
      )}
    </section>
  );
}
