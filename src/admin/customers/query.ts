// La búsqueda y la página de la lista de alumnos viven en la dirección
// (`?q=ana&pagina=2`): se pueden compartir, volver atrás y paginar sin perderlas.
// Todo lo que llega de la dirección es texto del usuario: lo que no se
// reconoce se ignora.

import { stripNul } from "@/admin/text";
import { firstValue, type SearchParams } from "@/admin/ui/search-params";

export interface StudentsQuery {
  /** Texto en el nombre o el Discord; ausente si no se busca nada. */
  q?: string;
  page: number;
}

const MAX_SEARCH_LENGTH = 100;
/** Más páginas que esto no existen: el desplazamiento seguiría siendo un entero seguro. */
const MAX_PAGE = 1_000_000;
const WHOLE_NUMBER = /^\d{1,9}$/;

/** Nombres de los parámetros de la dirección. */
export const STUDENTS_PARAMS = { q: "q", page: "pagina" } as const;

/** La búsqueda y la página que dice la dirección. */
export function parseStudentsQuery(params: SearchParams): StudentsQuery {
  const q = stripNul(firstValue(params[STUDENTS_PARAMS.q]) ?? "")
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
  const page = firstValue(params[STUDENTS_PARAMS.page])?.trim();
  const pageNumber = page && WHOLE_NUMBER.test(page) ? Number(page) : 1;
  return { ...(q ? { q } : {}), page: Math.min(Math.max(pageNumber, 1), MAX_PAGE) };
}

/**
 * La parte `?…` de la dirección para esta búsqueda y esta página; vacía si no
 * hay nada que escribir. La página 1 no se escribe.
 */
export function studentsQueryString(q: string | undefined, page = 1): string {
  const params = new URLSearchParams();
  if (q) params.set(STUDENTS_PARAMS.q, q);
  if (page > 1) params.set(STUDENTS_PARAMS.page, String(page));
  const text = params.toString();
  return text ? `?${text}` : "";
}
