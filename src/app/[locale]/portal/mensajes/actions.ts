"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { markRead, sendStudentMessage, type SendResult } from "@/chat/conversations";
import { notifyChatMessage } from "@/chat/emails";
import type { ChatFormState } from "@/chat/form-state";
import { getDb } from "@/db/client";
import { getCurrentStudent } from "@/portal/current";

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Solo el tipo del error: el mensaje podría traer la conexión a la base o el texto del alumno. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Lo que ve el alumno de cada resultado. Un repetido (un doble clic, o reenviar con el botón Atrás) ya
 * está guardado: se muestra como enviado. `no-account` no le pasa al alumno (es de Tallami): si pasara,
 * es una falla.
 */
function stateFor(result: SendResult, body: string): ChatFormState {
  switch (result.kind) {
    case "sent":
    case "duplicate":
      return { outcome: "sent", body: "" };
    case "invalid":
      return { outcome: "invalid", body };
    case "rate-limited":
      return { outcome: "rate-limited", body };
    case "no-account":
      return { outcome: "failed", body };
  }
}

/**
 * El alumno le escribe a Tallami. La cuenta sale de la sesión y el alumno, de esa cuenta: del formulario
 * llega solo el texto (`body`); cualquier otro campo se ignora. Sin sesión o con una cuenta sin vincular
 * responde `signed-out`, sin tocar nada. Lo que no se envió vuelve en `body`, para que siga en el cuadro.
 * El aviso a Tallami sale después de responder, y solo cuando el envío lo pide.
 */
export async function sendStudentMessageAction(_previous: ChatFormState, formData: FormData): Promise<ChatFormState> {
  const body = textField(formData, "body");
  try {
    const account = await getCurrentStudent();
    const customerId = account?.customerId;
    if (!customerId) return { outcome: "signed-out", body };
    const db = await getDb();
    const result = await sendStudentMessage(db, customerId, body);
    if (result.kind === "sent") {
      if (result.notify) after(() => notifyChatMessage(db, customerId, "student"));
      revalidatePath("/[locale]/portal/mensajes", "page");
    }
    return stateFor(result, body);
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[mensajes] no se pudo enviar el mensaje del alumno: ${errorName(error)}`);
    return { outcome: "failed", body };
  }
}

/**
 * La página de mensajes se abrió de verdad (o llegaron mensajes nuevos con la pestaña a la vista): la
 * conversación de la cuenta de la sesión queda leída por el alumno. Sin sesión o sin vincular no hace
 * nada. Nunca tira: si falla, se marca la próxima vez.
 */
export async function markStudentReadAction(): Promise<void> {
  try {
    const account = await getCurrentStudent();
    if (!account?.customerId) return;
    await markRead(await getDb(), account.customerId, "student");
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[mensajes] no se pudo marcar como leída la conversación del alumno: ${errorName(error)}`);
  }
}
