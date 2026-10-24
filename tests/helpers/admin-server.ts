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

/**
 * Los puertos de los tres servidores de los e2e: el principal (`playwright.config.ts`),
 * el de los datos de ejemplo (`playwright.demo.config.ts`) y el de la seguridad del
 * ingreso (`playwright.security.config.ts`). Nunca el 3000, que es el de desarrollo.
 */
export const E2E_PORTS = { main: 3100, demo: 3101, security: 3102 } as const;

/** La dirección de un servidor de los e2e: también es el origen de sus llaves de acceso. */
export function e2eBaseUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Carga las llaves de prueba (`tests/helpers/webauthn.ts`) en la base de un servidor
 * antes de arrancarlo. Va en el `webServer.command` de las configuraciones principal y
 * de datos de ejemplo, que entran al panel con ellas; la de seguridad empieza sin
 * ninguna. Es un script de npm (`e2e:seed-passkeys` en `package.json`) y no `npx tsx`: npm usa
 * el `tsx` de `node_modules` y, si falta, falla; `npx` lo bajaría de internet.
 */
export const SEED_E2E_PASSKEYS_COMMAND = "npm run e2e:seed-passkeys";

/** Base PGlite de los e2e: una carpeta temporal que se borra al arrancar. */
const E2E_PGLITE_DIR = path.join(os.tmpdir(), "tallami-coaching-e2e-pglite");
/** Base PGlite de los e2e con datos de ejemplo (`playwright.demo.config.ts`): otra carpeta, también se borra al arrancar. */
const E2E_DEMO_PGLITE_DIR = path.join(os.tmpdir(), "tallami-coaching-e2e-demo-pglite");
/** Base PGlite de los e2e de seguridad (`playwright.security.config.ts`): otra carpeta, vacía al arrancar. */
const E2E_SECURITY_PGLITE_DIR = path.join(os.tmpdir(), "tallami-coaching-e2e-security-pglite");

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
 * Variables de entorno de un servidor del panel de prueba en el puerto `port`, con
 * su base en `pgliteDir` (vacía al arrancar). `DATABASE_URL` va siempre vacía,
 * aunque el entorno de quien corre los tests tenga una: los e2e cargan ventas y
 * alumnos y nunca pueden escribir en una base remota.
 */
async function serverEnv(pgliteDir: string, port: number): Promise<Record<string, string>> {
  return {
    ADMIN_PASSWORD_HASH: ADMIN_TEST_PASSWORD_HASH,
    ADMIN_SESSION_SECRET: ADMIN_TEST_SESSION_SECRET,
    // Las llaves de acceso del servidor son las de su propia dirección (el navegador de los tests
    // las crea y las usa en `localhost:<puerto>`), no las del sitio público.
    ADMIN_WEBAUTHN_ORIGIN: e2eBaseUrl(port),
    PGLITE_DIR: resetPgliteDir(pgliteDir),
    EXCHANGE_RATE_SOURCE: "fixed",
    DATABASE_URL: "",
    // Sin clave de Resend ni dirección, el panel no manda avisos por email: ningún test manda uno de
    // verdad aunque el entorno de quien corre los tests tenga las variables, y Seguridad dice "sin configurar".
    RESEND_API_KEY: "",
    ADMIN_ALERT_EMAIL: "",
    ADMIN_ALERT_FROM: "",
    // Con esta marca, Next (`@next/env`) no lee los `.env*` de la carpeta: los servidores de prueba
    // usan solo este entorno, nunca el `.env.local` de quien corre los tests. Ese archivo puede
    // traer una `DATABASE_URL` real, y su hash de contraseña lleva `$` escapados que la expansión
    // de variables de Next desarma. (Lo mismo vale para el build que arma el comando del servidor.)
    __NEXT_PROCESSED_ENV: "true",
  };
}

/** Variables de entorno con las que Playwright arranca el servidor del panel. */
export function adminServerEnv(): Promise<Record<string, string>> {
  return serverEnv(E2E_PGLITE_DIR, E2E_PORTS.main);
}

/**
 * Lo mismo para el servidor de los datos de ejemplo: su propia carpeta de base,
 * vacía al arrancar (el comando de la configuración la siembra antes de
 * levantar el servidor; la base del servidor principal no se toca).
 */
export function demoServerEnv(): Promise<Record<string, string>> {
  return serverEnv(E2E_DEMO_PGLITE_DIR, E2E_PORTS.demo);
}

/**
 * Lo mismo para el servidor de la seguridad del ingreso: su propia carpeta de
 * base, vacía al arrancar y sin llaves (su primer test registra la primera).
 */
export function securityServerEnv(): Promise<Record<string, string>> {
  return serverEnv(E2E_SECURITY_PGLITE_DIR, E2E_PORTS.security);
}
