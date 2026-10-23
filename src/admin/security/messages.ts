// Los avisos de Configuración → Seguridad que se repiten en más de una pantalla.

import { PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";

export const INVALID_NAME_MESSAGE = `El nombre tiene que tener entre 1 y ${PASSKEY_NAME_MAX_LENGTH} caracteres.`;
/** Borrar la última llave dejaría el panel en "solo contraseña". */
export const LAST_KEY_MESSAGE = "Agregá otra llave antes de borrar esta.";
export const MISSING_KEY_MESSAGE = "Esa llave ya no está. Actualizamos la lista.";
