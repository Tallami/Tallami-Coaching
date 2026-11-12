import type { ComponentProps } from "react";
import { unreadConversationsForMenu } from "@/admin/chat/unread-count";
import { AdminShell } from "@/admin/ui/admin-shell";
import { logoutAction } from "./actions";

/**
 * El marco del panel (`AdminShell`) con el botón Salir conectado a su acción
 * (`logoutAction`) y el número de conversaciones sin leer junto a Mensajes.
 * `AdminShell` vive en `src/admin/ui` y no importa nada de `src/app`: las páginas
 * lo usan a través de este, que es quien conoce la acción y lee el número (verificando
 * antes la sesión del panel).
 */
export async function PanelShell(props: Omit<ComponentProps<typeof AdminShell>, "logoutAction" | "badges">) {
  const unread = await unreadConversationsForMenu();
  return <AdminShell {...props} logoutAction={logoutAction} badges={{ messages: unread }} />;
}
