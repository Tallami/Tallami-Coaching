import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import { saira } from "@/lib/fonts";
import "../globals.css";

/**
 * Layout raíz del panel de admin: segundo layout raíz de la app, aparte del de
 * `[locale]`. El panel está solo en español, fuera de next-intl, así que este
 * layout no usa ninguna API de next-intl ni el parámetro de idioma. Navegar
 * entre el sitio público y el panel es una carga de página completa.
 *
 * Privado: `noindex` en todas sus páginas (y `/admin` bloqueado en
 * `robots.txt`; el `proxy` suma `X-Robots-Tag`).
 */
export const metadata: Metadata = {
  title: { default: "Panel", template: "%s · Panel de Tallami" },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

/** Mismo azul que el escenario (`--color-stage`): barra del navegador en celular. */
export const viewport: Viewport = { themeColor: "#0B1433" };

/**
 * Todas las páginas del panel leen la cookie de sesión (un dato del pedido), así
 * que no pueden entrar en la parte estática del build. El `Suspense` deja
 * prerenderizada solo la cáscara vacía y arma el resto en cada pedido.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={saira.variable}>
      <body>
        <Suspense fallback={null}>{children}</Suspense>
      </body>
    </html>
  );
}
