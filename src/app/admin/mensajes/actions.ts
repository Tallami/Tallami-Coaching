"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { requireAdmin } from "@/admin/auth/require-admin";
import { ADMIN_ROUTES } from "@/admin/routes";
import { deleteConversation, markRead, sendCoachMessage, type SendResult } from "@/chat/conversations";
import { notifyChatMessage } from "@/chat/emails";
import type { ChatFormState } from "@/chat/form-state";
import { getDb } from "@/db/client";

// Las acciones de Tallami en la sección Mensajes. Como todas las del panel, verifican la sesión antes de
// todo. El alumno llega como primer argumento atado (`action.bind(null, customerId)`); cada función del
// dominio lo revisa como UUID antes de usarlo.

const CONVERSATION_PAGE = "/admin/mensajes/[customerId]";

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Solo el tipo del error: el mensaje podría traer la conexión a la base o el texto escrito. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** Lo que ve Tallami de cada resultado. Un repetido ya está guardado: se muestra como enviado. */
function stateFor(result: SendResult, body: string): ChatFormState {
  switch (result.kind) {
    case "sent":
    case "duplicate":
      return { outcome: "sent", body: "" };
    case "invalid":
      return { outcome: "invalid", body };
    case "no-account":
      return { outcome: "no-account", body };
    case "rate-limited":
      // Tallami no tiene tope: si pasara, es una falla.
      return { outcome: "failed", body };
  }
}

/**
 * Tallami le escribe al alumno `customerId`. Si el alumno no tiene una cuenta vinculada (o no existe, o la
 * perdió mientras escribía) no se guarda nada y vuelve `no-account` con el texto. El aviso por email sale
 * después de responder, y solo cuando el envío lo pide.
 */
export async function sendCoachMessageAction(
  customerId: string,
  _previous: ChatFormState,
  formData: FormData,
): Promise<ChatFormState> {
  await requireAdmin();
  const body = textField(formData, "body");
  try {
    const db = await getDb();
    const result = await sendCoachMessage(db, customerId, body);
    if (result.kind === "sent") {
      if (result.notify) after(() => notifyChatMessage(db, customerId, "coach"));
      revalidatePath(CONVERSATION_PAGE, "page");
    }
    return stateFor(result, body);
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[mensajes] no se pudo enviar el mensaje de Tallami: ${errorName(error)}`);
    return { outcome: "failed", body };
  }
}

/** La conversación se abrió de verdad (o llegaron mensajes con la pestaña a la vista): queda leída por Tallami. Nunca tira. */
export async function markCoachReadAction(customerId: string): Promise<void> {
  await requireAdmin();
  try {
    await markRead(await getDb(), customerId, "coach");
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[mensajes] no se pudo marcar como leída la conversación: ${errorName(error)}`);
  }
}

/** Lo que vuelve cuando no se pudo borrar: la página lo dice y deja probar de nuevo. Si se borró, redirige. */
export type DeleteConversationResult = { ok: false };

/**
 * Borra la conversación entera del alumno y vuelve a la bandeja con un aviso. Si la base no contesta, no
 * tira: devuelve `{ ok: false }` (y anota solo el tipo del error).
 */
export async function deleteConversationAction(customerId: string): Promise<DeleteConversationResult> {
  await requireAdmin();
  try {
    await deleteConversation(await getDb(), customerId);
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[mensajes] no se pudo borrar la conversación: ${errorName(error)}`);
    return { ok: false };
  }
  redirect(`${ADMIN_ROUTES.messages}?borrada=1`);
}
