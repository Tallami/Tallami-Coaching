import type { Metadata } from "next";
import { loadLoginStep } from "@/admin/auth/login-steps";
import { PASSKEY_STEP_PATH, loginPath } from "@/admin/auth/redirect";
import { getWebAuthnConfig } from "@/admin/auth/webauthn-config";
import { firstValue } from "@/admin/ui/search-params";
import { EnrollmentCodeStep } from "@/components/admin/enrollment-code-step";
import { LoginDoneCard } from "@/components/admin/login-card";
import { PasskeyStep } from "@/components/admin/passkey-step";
import { beginPasskeyLoginAction, finishPasskeyLoginAction } from "./actions";
import { beginCodePasskeyAction, finishCodePasskeyAction, redeemCodeAction } from "./code-actions";

export const metadata: Metadata = { title: "Tu llave" };

/**
 * El segundo paso del ingreso: confirmar con una llave, o, con "Tengo un código",
 * registrar la llave de este dispositivo. Es una puerta del panel (sin
 * `requireAdmin()`): sin un ingreso a medio camino válido vuelve al login (ver
 * `loadLoginStep`). Un ingreso que ya canjeó su código (tipo `code`) muestra
 * directamente el registro de la llave, también al recargar la página.
 */
export default async function PasskeyLoginPage(props: PageProps<"/admin/login/llave">) {
  const { next } = await props.searchParams;
  const step = await loadLoginStep(PASSKEY_STEP_PATH, firstValue(next));
  if (step.kind === "signed-in") return <LoginDoneCard />;

  const { nextPath, device, mode } = step.pending;
  const origin = getWebAuthnConfig().origin;
  const restartHref = loginPath({ next: nextPath });
  const expiredHref = loginPath({ next: nextPath, error: "expired" });
  const blockedHref = loginPath({ next: nextPath, error: "blocked" });
  const code = { redeem: redeemCodeAction, begin: beginCodePasskeyAction, finish: finishCodePasskeyAction, defaultName: device };

  if (mode === "code") {
    return (
      <EnrollmentCodeStep
        initialPhase="register"
        {...code}
        origin={origin}
        restartHref={restartHref}
        expiredHref={expiredHref}
        blockedHref={blockedHref}
      />
    );
  }
  return (
    <PasskeyStep
      begin={beginPasskeyLoginAction}
      finish={finishPasskeyLoginAction}
      origin={origin}
      restartHref={restartHref}
      expiredHref={expiredHref}
      blockedHref={blockedHref}
      code={code}
    />
  );
}
