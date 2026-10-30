// Lo que la página del portal entiende de su dirección y del estado de la sesión, para decidir qué
// aviso mostrar. La dirección la escribe cualquiera: solo se reconoce lo exacto (una de las tres
// respuestas del canje de una invitación, o un token con la forma de una), y un aviso sobre una
// cuenta nunca aparece frente a una persona que no tiene esa cuenta o que no está en ese estado
// (un `?invitacion=vinculada` escrito a mano no hace aparecer un "tu cuenta quedó vinculada").
//
//   ?ingreso=fallido                          el ingreso no se pudo completar (`SIGN_IN_FAILED_QUERY`)
//   ?invitacion=vinculada|invalida|ocupada    lo que pasó con la invitación al volver del ingreso
//   ?invitacion=<token>                       el link que Tallami le manda al alumno

import { INVITE_OUTCOMES, type InviteOutcome } from "./invites";
import { inviteTokenFrom } from "./oauth/flow";

/** Lo que la página lee de la dirección. */
export type PortalQuery = {
  /** La invitación del link, si la dirección trae una con la forma de un token. */
  inviteToken: string | null;
  /** Lo que el ingreso cuenta de la invitación con la que volvió. */
  inviteOutcome: InviteOutcome | null;
  /** El ingreso no se pudo completar. */
  signInFailed: boolean;
};

/** Cómo está quien mira la página: sin sesión, con una cuenta sin vincular o con una cuenta vinculada a un alumno. */
export type PortalView = "signedOut" | "unlinked" | "linked";

/** Los avisos que puede mostrar la página (cada uno tiene su texto en `Portal.notices`). */
export const NOTICE_KEYS = [
  "signInFailed",
  "inviteToSignIn",
  "linked",
  "alreadyLinked",
  "inviteInvalid",
  "inviteTaken",
  "inviteOtherAccount",
] as const;
export type NoticeKey = (typeof NOTICE_KEYS)[number];

export type PortalNotice = {
  key: NoticeKey;
  /** `error` se anuncia con urgencia; `info` y `success`, sin interrumpir. */
  tone: "info" | "success" | "error";
};

type RawSearchParams = Record<string, string | string[] | undefined>;

/** `?clave=a&clave=b` llega como lista: vale el primero. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asOutcome(value: string | undefined): InviteOutcome | null {
  return INVITE_OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/** Lo que dice la dirección. Lo que no se reconoce exacto se ignora. */
export function parsePortalQuery(params: RawSearchParams): PortalQuery {
  const invitation = first(params.invitacion);
  return {
    inviteToken: inviteTokenFrom(invitation),
    inviteOutcome: asOutcome(invitation),
    signInFailed: first(params.ingreso) === "fallido",
  };
}

const NOTICES = {
  signInFailed: { key: "signInFailed", tone: "error" },
  inviteToSignIn: { key: "inviteToSignIn", tone: "info" },
  linked: { key: "linked", tone: "success" },
  alreadyLinked: { key: "alreadyLinked", tone: "info" },
  inviteInvalid: { key: "inviteInvalid", tone: "error" },
  inviteTaken: { key: "inviteTaken", tone: "error" },
  inviteOtherAccount: { key: "inviteOtherAccount", tone: "info" },
} as const satisfies Record<NoticeKey, PortalNotice>;

/**
 * El aviso que corresponde a la dirección y al estado de la sesión, o `null`. Un solo aviso, el más
 * importante. Una cuenta sin vincular que abre el link de una invitación no recibe un aviso: la
 * vista misma le dice que entre de nuevo para usarla. Una cuenta ya vinculada que la abre sí: entró
 * con otra cuenta y tiene que salir para usarla.
 */
export function portalNotice(query: PortalQuery, view: PortalView): PortalNotice | null {
  if (query.signInFailed) return NOTICES.signInFailed;
  if (view === "signedOut") return query.inviteToken ? NOTICES.inviteToSignIn : null;
  if (query.inviteOutcome === "ocupada") return NOTICES.inviteTaken;
  if (view === "linked") {
    if (query.inviteOutcome === "vinculada") return NOTICES.linked;
    // Reintentar con una invitación ya usada, con la cuenta vinculada, no es un problema.
    if (query.inviteOutcome === "invalida") return NOTICES.alreadyLinked;
    // El link de una invitación (con su token) abierto con una cuenta que ya es de un alumno: sin este
    // aviso vería sus propias compras sin saber por qué no pasó nada con la invitación.
    return query.inviteToken ? NOTICES.inviteOtherAccount : null;
  }
  return query.inviteOutcome === "invalida" ? NOTICES.inviteInvalid : null;
}
