// Los borradores de los formularios del panel, en `sessionStorage` (se borra al cerrar la
// pestaña). Sirven para que, si la sesión terminó justo al guardar, lo escrito vuelva después de
// entrar de nuevo. Es una comodidad: si el navegador no deja guardar, el formulario sigue
// funcionando igual, sin borradores.
//
// Cómo se decide qué vuelve (no se puede saber, al enviar, si el envío va a salir bien):
// - Al enviar, el formulario deja un borrador "pendiente" con la hora y la página donde se escribió.
// - Si el envío salió bien, nadie lo toca: el formulario no vuelve a aparecer con eso.
// - Si la sesión había terminado, `requireAdmin()` (o el `proxy`) manda al login con
//   `?error=vencida`, y el login deja una "marca de recuperación" con la hora y la página a la que
//   vuelve (`next`).
// - Al abrir un formulario con un borrador pendiente: si hay una marca posterior (y cercana) al
//   borrador y es de la página donde se escribió, es de ese envío y se recupera; si no, se tira.
//   Un envío exitoso nunca reaparece.

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
  /** La página donde se escribió (ruta y búsqueda, sin avisos de un solo uso), como la anota el login en la marca. */
  page: string;
  fields: readonly DraftField[];
}

/** La marca que deja el login: cuándo se llegó y a qué página se vuelve después de entrar. */
interface Claim {
  at: number;
  next: string;
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
    const { at, page, fields } = parsed as { at?: unknown; page?: unknown; fields?: unknown };
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    if (typeof page !== "string") return null;
    if (!Array.isArray(fields) || !fields.every(isField)) return null;
    return { at, page, fields };
  } catch {
    // Un borrador ilegible es como no tener borrador: el que llama lo borra.
    return null;
  }
}

function parseClaim(raw: string | null): Claim | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { at, next } = parsed as { at?: unknown; next?: unknown };
    if (typeof at !== "number" || !Number.isFinite(at) || typeof next !== "string") return null;
    return { at, next };
  } catch {
    // Una marca ilegible es como no tener marca.
    return null;
  }
}

/** Guarda el borrador pendiente de `key`: lo que tenía el formulario al enviarse, y la `page` donde estaba. */
export function saveDraft(
  storage: Storage,
  key: string,
  fields: readonly DraftField[],
  now: number,
  page: string,
): void {
  const record: DraftRecord = { at: now, page, fields };
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

  const claim = parseClaim(storage.getItem(CLAIM_KEY));
  if (claim === null || claim.next !== draft.page) return null;
  if (claim.at < draft.at || claim.at - draft.at > CLAIM_WINDOW_MS) return null;

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
 * El login llegó por una sesión que terminó: deja la marca de recuperación, con la página `next` a
 * la que va a volver. Si ya hay una marca más nueva que todos los borradores (el mismo login que se
 * recarga, un rato después), se conserva la primera: la hora que cuenta es la del envío, no la de la
 * recarga.
 */
export function markRecovery(storage: Storage, now: number, next: string): void {
  const existing = parseClaim(storage.getItem(CLAIM_KEY));
  if (existing !== null && existing.at >= newestDraftAt(storage)) return;
  try {
    const claim: Claim = { at: now, next };
    storage.setItem(CLAIM_KEY, JSON.stringify(claim));
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
