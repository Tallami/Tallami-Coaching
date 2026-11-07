"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { notifyReplayCodesSent } from "@/payments/emails";
import { submitReplayCodes, type SubmitReplayCodesResult } from "@/payments/replay-codes";
import { getCurrentStudent } from "@/portal/current";

/** Cómo quedó el último envío del formulario de códigos. `failed`: la base no contestó. */
export type ReplayFormState = { outcome: "idle" | SubmitReplayCodesResult | "failed" };

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * El alumno manda (o corrige) los códigos de replay de una compra. La cuenta sale siempre de la sesión:
 * del formulario solo llega qué compra y el texto. Una compra ajena responde como si no existiera.
 */
export async function submitReplayCodesAction(_previous: ReplayFormState, formData: FormData): Promise<ReplayFormState> {
  try {
    const account = await getCurrentStudent();
    if (!account?.customerId) return { outcome: "not-found" };
    const db = await getDb();
    const saleId = textField(formData, "saleId");
    const outcome = await submitReplayCodes(db, {
      customerId: account.customerId,
      saleId,
      codes: textField(formData, "codes"),
    });
    if (outcome === "saved") after(() => notifyReplayCodesSent(db, saleId));
    if (outcome === "saved" || outcome === "corrected") revalidatePath("/[locale]/portal", "page");
    return { outcome };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[pagos] no se pudieron guardar los códigos:", error instanceof Error ? error.name : typeof error);
    return { outcome: "failed" };
  }
}
