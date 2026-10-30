// La tarjeta "Portal del alumno" de la ficha. Cuando el portal no está configurado (faltan las
// variables de Vercel), `createPortalInviteAction` igual genera el link, pero el link no va a
// funcionar: la tarjeta lo avisa en vez de dejar que Tallami se lo mande a un alumno.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { PortalCard } from "@/admin/customers/portal-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/admin/alumnos/[id]/portal-actions", () => ({
  createPortalInviteAction: vi.fn(),
  deletePortalAccountAction: vi.fn(),
  unlinkPortalAccountAction: vi.fn(),
}));

const CUSTOMER_ID = "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10";
const WARNING =
  "El portal todavía no está configurado: el link no va a funcionar hasta que cargues las variables.";
const LINKED = { provider: "discord", displayName: "Ana" } as const;

function html(props: { account: typeof LINKED | null; portalConfigured: boolean }): string {
  return renderToStaticMarkup(createElement(PortalCard, { customerId: CUSTOMER_ID, ...props }));
}

describe("PortalCard when the portal is not configured", () => {
  test("an account without a link shows the warning, still offers the invitation and says it as a status", () => {
    const markup = html({ account: null, portalConfigured: false });

    expect(markup).toContain(WARNING);
    expect(markup).toContain("Invitar al portal");
    // Es un aviso para leer con calma, no una alarma: el rol lo da el componente de avisos.
    expect(markup).toMatch(/<div[^>]*role="status"[^>]*>[^<]*El portal todavía no está configurado/);
  });

  test("the warning comes before the button that generates the link", () => {
    const markup = html({ account: null, portalConfigured: false });

    expect(markup.indexOf(WARNING)).toBeLessThan(markup.indexOf("Invitar al portal"));
  });

  test("a linked student has no invitation to warn about", () => {
    const markup = html({ account: LINKED, portalConfigured: false });

    expect(markup).not.toContain(WARNING);
    expect(markup).toContain("Vinculado");
  });
});

describe("PortalCard when the portal is configured", () => {
  test("shows no warning", () => {
    expect(html({ account: null, portalConfigured: true })).not.toContain("todavía no está configurado");
    expect(html({ account: LINKED, portalConfigured: true })).not.toContain("todavía no está configurado");
  });
});
