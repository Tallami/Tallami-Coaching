import type { Metadata } from "next";
import { loadLoginStep } from "@/admin/auth/login-steps";
import { FIRST_KEY_STEP_PATH, loginPath } from "@/admin/auth/redirect";
import { getWebAuthnConfig } from "@/admin/auth/webauthn-config";
import { firstValue } from "@/admin/ui/search-params";
import { FirstPasskey } from "@/components/admin/first-passkey";
import { LoginDoneCard } from "@/components/admin/login-card";
import { beginFirstPasskeyAction, finishFirstPasskeyAction } from "./actions";

export const metadata: Metadata = { title: "Tu primera llave" };

/**
 * El segundo paso cuando todavía no hay ninguna llave: registrar la primera. Es una
 * puerta del panel (sin `requireAdmin()`): solo se ve con un ingreso a medio camino
 * de tipo "primera llave", que la contraseña abre únicamente si no hay ninguna (ver
 * `loadLoginStep`).
 */
export default async function FirstPasskeyPage(props: PageProps<"/admin/login/primera-llave">) {
  const { next } = await props.searchParams;
  const step = await loadLoginStep(FIRST_KEY_STEP_PATH, firstValue(next));
  if (step.kind === "signed-in") return <LoginDoneCard />;

  const { nextPath, device } = step.pending;
  return (
    <FirstPasskey
      begin={beginFirstPasskeyAction}
      finish={finishFirstPasskeyAction}
      origin={getWebAuthnConfig().origin}
      defaultName={device}
      restartHref={loginPath({ next: nextPath })}
      expiredHref={loginPath({ next: nextPath, error: "expired" })}
      blockedHref={loginPath({ next: nextPath, error: "blocked" })}
    />
  );
}
