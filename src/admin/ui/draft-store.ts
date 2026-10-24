// Los borradores de los formularios del panel, en `sessionStorage` (se borra al cerrar la
// pestaña). Sirven para que, si la sesión terminó justo al guardar, lo escrito vuelva después de
// entrar de nuevo. Es una comodidad: si el navegador no deja guardar, el formulario sigue
// funcionando igual, sin borradores.
//
// Cómo se decide qué vuelve (no se puede saber, al enviar, si el envío va a salir bien):
// - Al enviar, el formulario deja un borrador "pendiente" con la hora.
// - Si el envío salió bien, nadie lo toca: el formulario no vuelve a aparecer con eso.
// - Si la sesión había terminado, `requireAdmin()` (o el `proxy`) manda al login con
//   `?error=vencida`, y el login deja una "marca de recuperación" con la hora.
// - Al abrir un formulario con un borrador pendiente: si hay una marca posterior (y cercana) al
//   borrador, es de ese envío y se recupera; si no, se tira. Un envío exitoso nunca reaparece.

export const DRAFT_PREFIX = "tallami-draft:";
export const CLAIM_KEY = "tallami-draft-claim";
/**
 * Cuánto después del envío puede llegar la marca para ser de ese envío: del envío al login hay un
 * pedido y una pantalla (segundos). Sin tope, una venta guardada bien hace una hora volvería a
 * aparecer cuando la sesión se cierre por inactividad mirando otra pantalla.
 */
export const CLAIM_WINDOW_MS = 2 * 60 * 1000;

export type DraftField = readonly [name: string, value: string];

export interface DraftRecord {
  /** Cuándo se envió el formulario (ms desde 1970). */
  at: number;
  fields: readonly DraftField[];
}

/** El almacenamiento de la pestaña, o `null` si el navegador no lo deja usar (modo privado, datos bloqueados). */
export function getDraftStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch (error) {
    console.warn("Panel: el navegador no deja guardar borradores.", error);
    return null;
  }
}

function draftKey(key: string): string {
  return `${DRAFT_PREFIX}${key}`;
}

function isField(value: unknown): value is DraftField {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "string";
}

function parseDraft(raw: string | null): DraftRecord | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { at, fields } = parsed as { at?: unknown; fields?: unknown };
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    if (!Array.isArray(fields) || !fields.every(isField)) return null;
    return { at, fields };
  } catch {
    // Un borrador ilegible es como no tener borrador: el que llama lo borra.
    return null;
  }
}

function parseClaim(raw: string | null): number | null {
  if (raw === null) return null;
  const at = Number(raw);
  return Number.isFinite(at) ? at : null;
}

/** Guarda el borrador pendiente de `key`: lo que tenía el formulario al enviarse. */
export function saveDraft(storage: Storage, key: string, fields: readonly DraftField[], now: number): void {
  const record: DraftRecord = { at: now, fields };
  try {
    storage.setItem(draftKey(key), JSON.stringify(record));
  } catch (error) {
    console.warn("Panel: no se pudo guardar el borrador del formulario.", error);
  }
}

export function removeDraft(storage: Storage, key: string): void {
  storage.removeItem(draftKey(key));
}

/**
 * Lo que hay que volver a poner en el formulario `key` al abrirlo, o `null`. El borrador pendiente
 * se saca siempre (si vuelve, ya está en el formulario; si no, se tira); la marca de recuperación
 * solo se gasta cuando de verdad se recupera algo.
 */
export function takeRecoverableDraft(storage: Storage, key: string): DraftRecord | null {
  const stored = storage.getItem(draftKey(key));
  if (stored === null) return null;
  const draft = parseDraft(stored);
  removeDraft(storage, key);
  if (draft === null) return null;

  const claimAt = parseClaim(storage.getItem(CLAIM_KEY));
  const isRecoverable = claimAt !== null && claimAt >= draft.at && claimAt - draft.at <= CLAIM_WINDOW_MS;
  if (!isRecoverable) return null;

  storage.removeItem(CLAIM_KEY);
  return draft;
}

function newestDraftAt(storage: Storage): number {
  let newest = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index);
    if (name === null || !name.startsWith(DRAFT_PREFIX)) continue;
    const draft = parseDraft(storage.getItem(name));
    if (draft !== null) newest = Math.max(newest, draft.at);
  }
  return newest;
}

/**
 * El login llegó por una sesión que terminó: deja la marca de recuperación. Si ya hay una marca
 * más nueva que todos los borradores (el mismo login que se recarga, un rato después), se conserva
 * la primera: la hora que cuenta es la del envío, no la de la recarga.
 */
export function markRecovery(storage: Storage, now: number): void {
  const existing = parseClaim(storage.getItem(CLAIM_KEY));
  if (existing !== null && existing >= newestDraftAt(storage)) return;
  try {
    storage.setItem(CLAIM_KEY, String(now));
  } catch (error) {
    console.warn("Panel: no se pudo dejar la marca de recuperación.", error);
  }
}

/** Borra todos los borradores y la marca (cerrar sesión a propósito): nada de lo escrito sobrevive. */
export function clearAllDrafts(storage: Storage): void {
  const names: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index);
    if (name !== null && name.startsWith(DRAFT_PREFIX)) names.push(name);
  }
  for (const name of names) storage.removeItem(name);
  storage.removeItem(CLAIM_KEY);
}

/** `clearAllDrafts` sobre el almacenamiento de la pestaña, si el navegador lo deja usar. */
export function clearStoredDrafts(): void {
  const storage = getDraftStorage();
  if (storage) clearAllDrafts(storage);
}
