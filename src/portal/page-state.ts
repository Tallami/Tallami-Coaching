// Lo que la página del portal entiende de su dirección y del estado de la sesión, para decidir qué
// aviso mostrar. La dirección la escribe cualquiera: solo se reconoce lo exacto (una de las tres
// respuestas del canje de una invitación, un token con la forma de una, un pedido con la forma de un
// UUID), y un aviso sobre una cuenta nunca aparece frente a una persona que no tiene esa cuenta o que
// no está en ese estado (un `?invitacion=vinculada` escrito a mano no hace aparecer un "tu cuenta quedó
// vinculada"; un `?compra=` de otro no hace aparecer nada).
//
//   ?ingreso=fallido                          el ingreso no se pudo completar (`SIGN_IN_FAILED_QUERY`)
//   ?invitacion=vinculada|invalida|ocupada    lo que pasó con la invitación al volver del ingreso
//   ?invitacion=<token>                       el link que Tallami le manda al alumno
//   ?compra=<id>&payment_id=<dígitos>         la vuelta de pagar. El `status` que agrega Mercado Pago ni
//                                             se lee: lo que se muestra sale del pedido en la base

import { isUuid } from "@/db/uuid";
import type { OrderStatus } from "@/payments/policy";
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
  /** El pedido con el que volvió de pagar. Falta ver que sea de esta cuenta. */
  orderId: string | null;
  /** El pago que dice Mercado Pago: solo sirve para saber qué consultar. */
  paymentId: string | null;
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
  "paymentApproved",
  "paymentPending",
  "paymentFailed",
] as const;
export type NoticeKey = (typeof NOTICE_KEYS)[number];

export type PortalNotice = {
  key: NoticeKey;
  /** `error` se anuncia con urgencia; `info` y `success`, sin interrumpir. */
  tone: "info" | "success" | "error";
};

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Un id de pago son dígitos, y no muchos: el cliente de Mercado Pago tampoco consulta otra cosa. */
const PAYMENT_ID = /^\d{1,20}$/;

/** `?clave=a&clave=b` llega como lista: vale el primero. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function asOutcome(value: string | undefined): InviteOutcome | null {
  return INVITE_OUTCOMES.find((outcome) => outcome === value) ?? null;
}

function asOrderId(value: string | undefined): string | null {
  return value !== undefined && isUuid(value) ? value : null;
}

function asPaymentId(value: string | undefined): string | null {
  return value !== undefined && PAYMENT_ID.test(value) ? value : null;
}

/** Lo que dice la dirección. Lo que no se reconoce exacto se ignora. */
export function parsePortalQuery(params: RawSearchParams): PortalQuery {
  const invitation = first(params.invitacion);
  return {
    inviteToken: inviteTokenFrom(invitation),
    inviteOutcome: asOutcome(invitation),
    signInFailed: first(params.ingreso) === "fallido",
    orderId: asOrderId(first(params.compra)),
    paymentId: asPaymentId(first(params.payment_id)),
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
  paymentApproved: { key: "paymentApproved", tone: "success" },
  paymentPending: { key: "paymentPending", tone: "info" },
  paymentFailed: { key: "paymentFailed", tone: "error" },
} as const satisfies Record<NoticeKey, PortalNotice>;

/**
 * Lo que se le dice a quien volvió de pagar, según cómo quedó el pedido. Reembolsado o en contracargo
 * no dice nada: es una dirección vieja, no la vuelta de un pago. Un `Record` para que un estado nuevo
 * obligue a decidirlo.
 */
const ORDER_NOTICES: Record<OrderStatus, PortalNotice | null> = {
  approved: NOTICES.paymentApproved,
  created: NOTICES.paymentPending,
  pending: NOTICES.paymentPending,
  rejected: NOTICES.paymentFailed,
  cancelled: NOTICES.paymentFailed,
  refunded: null,
  charged_back: null,
};

/**
 * El aviso que corresponde a la dirección y al estado de la sesión, o `null`. Un solo aviso, el más
 * importante. Una cuenta sin vincular que abre el link de una invitación no recibe un aviso: la
 * vista misma le dice que entre de nuevo para usarla. Una cuenta ya vinculada que la abre sí: se le
 * dice que su cuenta ya está vinculada y que, si la invitación es para otra cuenta, salga y entre con esa.
 *
 * `orderStatus` es el estado del pedido de `query.orderId`, solo si es de la cuenta en sesión: quien
 * llama lo lee con `orderForAccount`, y el pedido de otro llega como `null`.
 */
export function portalNotice(query: PortalQuery, view: PortalView, orderStatus: OrderStatus | null = null): PortalNotice | null {
  if (query.signInFailed) return NOTICES.signInFailed;
  if (view === "signedOut") return query.inviteToken ? NOTICES.inviteToSignIn : null;
  if (query.orderId && orderStatus) return ORDER_NOTICES[orderStatus];
  if (query.inviteOutcome === "ocupada") return NOTICES.inviteTaken;
  if (view === "linked") {
    if (query.inviteOutcome === "vinculada") return NOTICES.linked;
    // Reintentar con una invitación ya usada, con la cuenta vinculada, no es un problema.
    if (query.inviteOutcome === "invalida") return NOTICES.alreadyLinked;
    // El link de una invitación (con su token) abierto con una cuenta que ya es de un alumno. Sin consultar
    // la base no se sabe de quién es: puede ser la suya, ya usada (tocar de nuevo el mensaje del chat), o la de
    // otra cuenta. El aviso sirve para las dos: dice que la cuenta ya está vinculada y qué hacer si es de otra.
    return query.inviteToken ? NOTICES.inviteOtherAccount : null;
  }
  return query.inviteOutcome === "invalida" ? NOTICES.inviteInvalid : null;
}
