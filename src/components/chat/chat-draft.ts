// Lo que se está escribiendo en el formulario de un mensaje, guardado en la pestaña (`sessionStorage`).
// Sirve para cuando el refresco de la página cambia la vista y el formulario desaparece (la sesión se
// cerró, la cuenta se desvinculó): al volver a la página en la misma pestaña, el texto vuelve al cuadro.
//
// Hay un solo lugar por superficie (el portal, el panel) y guarda de quién es (`owner`): el borrador
// solo vuelve a su dueño. Si al abrir el formulario el lugar es de otro, se borra: lo escrito por una
// persona nunca se le muestra a otra. Es una comodidad: si el navegador no deja guardar (modo privado,
// datos bloqueados), el formulario anda igual, sin borrador.

/** Las superficies que guardan borrador: cada una tiene su lugar en la pestaña. */
export type ChatDraftSurface = "portal" | "admin";

const SLOT_PREFIX = "tallami.chat.draft.";

interface StoredDraft {
  owner: string;
  body: string;
}

/** La clave del dueño de un borrador: la superficie y el alumno de la conversación (`portal:<id>`, `admin:<id>`). */
export function chatDraftKey(surface: ChatDraftSurface, customerId: string): string {
  return `${surface}:${customerId}`;
}

/** El lugar de la pestaña de la superficie de `draftKey` (lo que va antes de los dos puntos). */
export function chatDraftSlot(draftKey: string): string {
  const colon = draftKey.indexOf(":");
  return `${SLOT_PREFIX}${colon === -1 ? draftKey : draftKey.slice(0, colon)}`;
}

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): StoredDraft | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { owner, body } = parsed as { owner?: unknown; body?: unknown };
    if (typeof owner !== "string" || typeof body !== "string") return null;
    return { owner, body };
  } catch {
    return null;
  }
}

/**
 * El borrador de `draftKey`, o `null`. Si el lugar tiene el de otro dueño (u otra cosa ilegible), lo
 * borra. Nunca falla: sin almacenamiento, no hay borrador.
 */
export function takeOwnDraft(draftKey: string): string | null {
  try {
    const storage = tabStorage();
    if (!storage) return null;
    const slot = chatDraftSlot(draftKey);
    const raw = storage.getItem(slot);
    if (raw === null) return null;
    const stored = parse(raw);
    if (stored === null || stored.owner !== draftKey) {
      storage.removeItem(slot);
      return null;
    }
    return stored.body === "" ? null : stored.body;
  } catch {
    return null;
  }
}

/** Guarda `body` como el borrador de `draftKey`; vacío, borra el lugar. Nunca falla. */
export function saveOwnDraft(draftKey: string, body: string): void {
  try {
    const storage = tabStorage();
    if (!storage) return;
    const slot = chatDraftSlot(draftKey);
    if (body === "") {
      storage.removeItem(slot);
      return;
    }
    const record: StoredDraft = { owner: draftKey, body };
    storage.setItem(slot, JSON.stringify(record));
  } catch {
    // Sin lugar (lleno, bloqueado): el cuadro sigue teniendo el texto; solo no sobrevive a otra vista.
  }
}

/** Borra el lugar de la superficie de `draftKey` (el mensaje salió). Nunca falla. */
export function clearOwnDraft(draftKey: string): void {
  saveOwnDraft(draftKey, "");
}
