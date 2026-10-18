import type { ComponentProps } from "react";
import { AdminShell } from "@/admin/ui/admin-shell";
import { logoutAction } from "./actions";

/**
 * El marco del panel (`AdminShell`) con el botón Salir conectado a su acción
 * (`logoutAction`). `AdminShell` vive en `src/admin/ui` y no importa nada de
 * `src/app`: las páginas lo usan a través de este, que es quien conoce la acción.
 */
export function PanelShell(props: Omit<ComponentProps<typeof AdminShell>, "logoutAction">) {
  return <AdminShell {...props} logoutAction={logoutAction} />;
}
