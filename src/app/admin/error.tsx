"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { loginPath } from "@/admin/auth/redirect";
import { PanelError } from "@/components/admin/panel-error";

interface AdminErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  retry: () => void;
}

/**
 * La red de contención de todo `/admin`: cualquier error que se escape de una
 * pantalla o de una acción del panel termina acá, en español y con una salida
 * (volver a intentar o ir al ingreso), en vez de en la página "Application error"
 * de Next. Por ejemplo, un Server Action con la sesión vencida que no se pudo
 * redirigir (ver `unauthorizedAction` en `src/admin/auth/guard.ts`) o una caída
 * de la base al abrir una pantalla.
 *
 * Va dentro del layout raíz del panel (`layout.tsx`), que solo arma `html` y
 * `body`: no hace falta un `global-error.tsx`, que además viviría en la raíz de
 * toda la app y cubriría también el sitio público.
 *
 * `retry` (y no `reset`) porque el error suele ser del servidor: vuelve a pedir
 * los datos en lugar de pintar de nuevo lo mismo. Con la sesión vencida ese
 * pedido termina en el ingreso. El error en sí no se usa: nada de él se muestra.
 */
export default function AdminError({ retry }: AdminErrorProps) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  const here = pathname ? `${pathname}${search ? `?${search}` : ""}` : undefined;

  return <PanelError retry={retry} loginHref={loginPath({ next: here })} />;
}
