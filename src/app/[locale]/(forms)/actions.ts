"use server";

import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { SITE_REQUEST_KINDS, type SiteRequestKind } from "@/payments/policy";
import { portalLocale } from "@/portal/oauth/flow";
import { isHoneypotFilled, publicFormIpHash } from "@/public-forms/guard";
import { submitSiteRequest } from "@/site-requests/requests";

/** Lo que el formulario sabe después de enviar. Los textos vuelven para no perder lo escrito. */
export interface RequestFormState {
  status: "idle" | "sent" | "invalid" | "limited" | "failed";
  /** Código de error por campo (`required`, `invalid`, `too-long`). */
  fieldErrors: Record<string, string>;
  values: Record<string, string>;
  /** El código de seguimiento, con `status: "sent"`. */
  code?: string;
}

const TEXT_FIELDS = ["name", "email", "orderReference", "message"] as const;

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function kindOf(formData: FormData): SiteRequestKind | null {
  const value = textField(formData, "kind");
  return SITE_REQUEST_KINDS.find((kind) => kind === value) ?? null;
}

/**
 * Enviar un pedido del sitio (arrepentimiento, baja o contacto). Público y sin cuenta: funciona
 * sin JavaScript. Nunca tira: si la base no contesta, el formulario lo dice y conserva lo escrito.
 */
export async function submitSiteRequestAction(_previous: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const now = new Date();
  const values = Object.fromEntries(TEXT_FIELDS.map((field) => [field, textField(formData, field)]));
  const kind = kindOf(formData);
  if (!kind) return { status: "failed", fieldErrors: {}, values };
  try {
    const result = await submitSiteRequest(
      await getDb(),
      kind,
      { ...values, locale: portalLocale(textField(formData, "locale")) } as Parameters<typeof submitSiteRequest>[2],
      { ipHash: publicFormIpHash(await headers(), now), honeypotFilled: isHoneypotFilled(formData) },
      {},
      now,
    );
    if (result.ok) return { status: "sent", fieldErrors: {}, values: {}, code: result.code };
    if ("limited" in result) return { status: "limited", fieldErrors: {}, values };
    return { status: "invalid", fieldErrors: result.fieldErrors, values };
  } catch (error) {
    console.error("[sitio] no se pudo guardar el pedido:", error instanceof Error ? error.name : typeof error);
    return { status: "failed", fieldErrors: {}, values };
  }
}
