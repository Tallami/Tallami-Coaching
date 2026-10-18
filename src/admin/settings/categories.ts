// Las categorías del monotributo, de la A a la K. Viven aparte de la validación
// (zod) para que el formulario de Configuración, que corre en el navegador, arme
// su lista sin traer zod con ella.

export const MONOTRIBUTO_CATEGORIES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;
export type MonotributoCategory = (typeof MONOTRIBUTO_CATEGORIES)[number];
