import type { Metadata } from "next";
import { loadLoginStep } from "@/admin/auth/login-steps";
import { PASSKEY_STEP_PATH, loginPath } from "@/admin/auth/redirect";
import { getWebAuthnConfig } from "@/admin/auth/webauthn-config";
import { firstValue } from "@/admin/ui/search-params";
import { LoginDoneCard } from "@/components/admin/login-card";
import { PasskeyStep } from "@/components/admin/passkey-step";
import { beginPasskeyLoginAction, finishPasskeyLoginAction } from "./actions";

export const metadata: Metadata = { title: "Tu llave" };

/**
 * El segundo paso del ingreso: confirmar con una llave. Es una puerta del panel
 * (sin `requireAdmin()`): sin un ingreso a medio camino válido vuelve al login
 * (ver `loadLoginStep`).
 */
export default async function PasskeyLoginPage(props: PageProps<"/admin/login/llave">) {
  const { next } = await props.searchParams;
  const step = await loadLoginStep(PASSKEY_STEP_PATH, firstValue(next));
  if (step.kind === "signed-in") return <LoginDoneCard />;

  const { nextPath } = step.pending;
  return (
    <PasskeyStep
      begin={beginPasskeyLoginAction}
      finish={finishPasskeyLoginAction}
      origin={getWebAuthnConfig().origin}
      restartHref={loginPath({ next: nextPath })}
      expiredHref={loginPath({ next: nextPath, error: "expired" })}
      blockedHref={loginPath({ next: nextPath, error: "blocked" })}
    />
  );
}
