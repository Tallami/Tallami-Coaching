// El nombre que Tallami le pone a una llave ("Celular", "PC", "Notebook"): de 1 a
// `PASSKEY_NAME_MAX_LENGTH` caracteres, sin espacios a los costados. Es el mismo en
// los tres lugares donde se registra o se renombra una llave (Configuración →
// Seguridad, la primera llave y el registro con un código), así que se define una
// sola vez. Vive acá y no en un archivo de acciones porque esos solo pueden exportar
// funciones asíncronas ("use server").

import { z } from "zod";
import { PASSKEY_NAME_MAX_LENGTH } from "./policy";

export const passkeyNameSchema = z.string().trim().min(1).max(PASSKEY_NAME_MAX_LENGTH);
