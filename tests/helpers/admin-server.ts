// Datos de prueba del acceso al panel que usa la configuración de Playwright
// para arrancar el servidor. Son valores de prueba: no valen en ningún otro
// entorno. Los tests e2e usan `tests/helpers/admin.ts`, que importa esto.
//
// Este archivo no importa `@playwright/test`: la configuración lo carga en el
// proceso principal y en cada worker.

import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashPassword } from "../../src/admin/auth/password";

export const ADMIN_TEST_PASSWORD = "clave-de-prueba-del-panel";
/** Más de 32 caracteres, el mínimo que exige el panel. */
export const ADMIN_TEST_SESSION_SECRET =
  "secreto-de-prueba-solo-para-los-e2e-0123456789";

/** Base PGlite de los e2e: una carpeta temporal que se borra al arrancar. */
const E2E_PGLITE_DIR = path.join(os.tmpdir(), "tallami-coaching-e2e-pglite");

/**
 * Borra la base de los e2e anteriores. Solo en el proceso principal de
 * Playwright: los workers también cargan la configuración y no pueden borrar
 * la base mientras el servidor la usa.
 */
function resetE2eDatabase(): string {
  if (process.env.TEST_WORKER_INDEX === undefined) {
    try {
      rmSync(E2E_PGLITE_DIR, { recursive: true, force: true });
      mkdirSync(path.dirname(E2E_PGLITE_DIR), { recursive: true });
    } catch (error) {
      // Un servidor viejo puede tener la carpeta abierta (Windows): se sigue
      // con lo que haya, el panel migra la base al abrirla.
      console.warn("No se pudo borrar la base de los e2e:", error);
    }
  }
  return E2E_PGLITE_DIR;
}

/** Variables de entorno con las que Playwright arranca el servidor del panel. */
export async function adminServerEnv(): Promise<Record<string, string>> {
  return {
    ADMIN_PASSWORD_HASH: await hashPassword(ADMIN_TEST_PASSWORD),
    ADMIN_SESSION_SECRET: ADMIN_TEST_SESSION_SECRET,
    PGLITE_DIR: resetE2eDatabase(),
    EXCHANGE_RATE_SOURCE: "fixed",
  };
}
