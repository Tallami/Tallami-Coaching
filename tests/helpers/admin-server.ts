// Datos de prueba del acceso al panel que usan las configuraciones de Playwright
// para arrancar el servidor. Son valores de prueba: no valen en ningún otro
// entorno. Los tests e2e usan `tests/helpers/admin.ts`, que importa esto.
//
// Este archivo no importa `@playwright/test`: las configuraciones lo cargan en
// el proceso principal y en cada worker.

import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ADMIN_TEST_PASSWORD = "clave-de-prueba-del-panel";
/**
 * Hash scrypt de `ADMIN_TEST_PASSWORD`, fijo. Las sesiones llevan un claim
 * derivado del hash de la contraseña (`src/admin/auth/password-claim.ts`): el
 * servidor de los e2e y los tests que firman sesiones tienen que usar el mismo
 * hash, y calcularlo en cada proceso daría uno distinto por la sal al azar.
 * `tests/unit/e2e-server-env.test.ts` comprueba que corresponde a la contraseña.
 */
export const ADMIN_TEST_PASSWORD_HASH =
  "scrypt$131072$8$1$zASgC6oh0nRcKv2kEl3tbQ==$tQGqq7QyqTr/jXICWaMh8tbjhxd18TqxqeHLEHdIxfg=";
/**
 * El hash de una contraseña anterior: mismo formato y mismos parámetros, otra
 * sal. Sirve para firmar una sesión de "antes de cambiar la contraseña": la
 * firma es válida pero su claim no coincide con el hash vigente. Lo usan los
 * tests unitarios y los e2e.
 */
export const ADMIN_TEST_OLD_PASSWORD_HASH = ADMIN_TEST_PASSWORD_HASH.replace(
  "zASgC6oh0nRcKv2kEl3tbQ==",
  "AAAAAAAAAAAAAAAAAAAAAA==",
);
/** Más de 32 caracteres, el mínimo que exige el panel. */
export const ADMIN_TEST_SESSION_SECRET =
  "secreto-de-prueba-solo-para-los-e2e-0123456789";

/** Base PGlite de los e2e: una carpeta temporal que se borra al arrancar. */
const E2E_PGLITE_DIR = path.join(os.tmpdir(), "tallami-coaching-e2e-pglite");
/** Base PGlite de los e2e con datos de ejemplo (`playwright.demo.config.ts`): otra carpeta, también se borra al arrancar. */
const E2E_DEMO_PGLITE_DIR = path.join(os.tmpdir(), "tallami-coaching-e2e-demo-pglite");

/**
 * Borra la base de los e2e anteriores. Solo en el proceso principal de
 * Playwright: los workers también cargan la configuración y no pueden borrar
 * la base mientras el servidor la usa.
 */
function resetPgliteDir(dir: string): string {
  if (process.env.TEST_WORKER_INDEX === undefined) {
    try {
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(path.dirname(dir), { recursive: true });
    } catch (error) {
      // Un servidor viejo puede tener la carpeta abierta (Windows): se sigue
      // con lo que haya, el panel migra la base al abrirla.
      console.warn("No se pudo borrar la base de los e2e:", error);
    }
  }
  return dir;
}

/**
 * Variables de entorno de un servidor del panel de prueba, con su base en
 * `pgliteDir` (vacía al arrancar). `DATABASE_URL` va siempre vacía, aunque el
 * entorno de quien corre los tests tenga una: los e2e cargan ventas y alumnos y
 * nunca pueden escribir en una base remota.
 */
async function serverEnv(pgliteDir: string): Promise<Record<string, string>> {
  return {
    ADMIN_PASSWORD_HASH: ADMIN_TEST_PASSWORD_HASH,
    ADMIN_SESSION_SECRET: ADMIN_TEST_SESSION_SECRET,
    PGLITE_DIR: resetPgliteDir(pgliteDir),
    EXCHANGE_RATE_SOURCE: "fixed",
    DATABASE_URL: "",
  };
}

/** Variables de entorno con las que Playwright arranca el servidor del panel. */
export function adminServerEnv(): Promise<Record<string, string>> {
  return serverEnv(E2E_PGLITE_DIR);
}

/**
 * Lo mismo para el servidor de los datos de ejemplo: su propia carpeta de base,
 * vacía al arrancar (el comando de la configuración la siembra antes de
 * levantar el servidor; la base del servidor principal no se toca).
 */
export function demoServerEnv(): Promise<Record<string, string>> {
  return serverEnv(E2E_DEMO_PGLITE_DIR);
}
