"use server";

import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { portalLocale } from "@/portal/oauth/flow";
import { submitProApplication } from "@/pro/applications";
import { isHoneypotFilled, publicFormIpHash } from "@/public-forms/guard";

/** Lo que el formulario sabe después de enviar. Los textos de los campos vuelven para no perder lo escrito. */
export interface ApplicationFormState {
  status: "idle" | "sent" | "invalid" | "limited" | "failed";
  /** Código de error por campo (`required`, `too-long`). */
  fieldErrors: Record<string, string>;
  values: Record<string, string>;
}

const TEXT_FIELDS = ["name", "discord", "teamMembers", "results", "message"] as const;

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Enviar la aplicación a la Temporada Pro. Pública y sin cuenta: funciona sin JavaScript. Valida,
 * aplica la trampa y los topes (`submitProApplication`) y nunca tira: si la base no contesta, el
 * formulario lo dice y conserva lo escrito.
 */
export async function applyToProAction(_previous: ApplicationFormState, formData: FormData): Promise<ApplicationFormState> {
  const now = new Date();
  const values = Object.fromEntries(TEXT_FIELDS.map((field) => [field, textField(formData, field)]));
  try {
    const result = await submitProApplication(
      await getDb(),
      {
        name: values.name,
        discord: values.discord,
        teamMembers: values.teamMembers,
        results: values.results,
        message: values.message,
        privacy: textField(formData, "privacy") === "yes",
        locale: portalLocale(textField(formData, "locale")),
      },
      { ipHash: publicFormIpHash(await headers(), now), honeypotFilled: isHoneypotFilled(formData) },
      now,
    );
    if (result.ok) return { status: "sent", fieldErrors: {}, values: {} };
    if ("limited" in result) return { status: "limited", fieldErrors: {}, values };
    return { status: "invalid", fieldErrors: result.fieldErrors, values };
  } catch (error) {
    console.error("[pro] no se pudo guardar la aplicación:", error instanceof Error ? error.name : typeof error);
    return { status: "failed", fieldErrors: {}, values };
  }
}
