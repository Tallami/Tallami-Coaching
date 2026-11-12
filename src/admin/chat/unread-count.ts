// El número de conversaciones sin leer que el menú del panel muestra junto a Mensajes.

import { unstable_rethrow } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import { countUnreadConversations } from "@/chat/conversations";
import { getDb } from "@/db/client";

/**
 * Cuántas conversaciones tienen algo sin leer para Tallami. Verifica la sesión del panel antes de leer
 * nada (sin sesión redirige al ingreso). Si la base falla devuelve 0: un número del menú no puede
 * romper la página; solo se anota el tipo del error.
 */
export async function unreadConversationsForMenu(): Promise<number> {
  await requireAdmin();
  try {
    return await countUnreadConversations(await getDb());
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[mensajes] no se pudo contar las conversaciones sin leer: ${error instanceof Error ? error.name : typeof error}`);
    return 0;
  }
}
