import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tiempo máximo de un test o de un `beforeAll`/`beforeEach`. Varios tests tardan
 * ~1 s solos pero dependen de algo que se estira con la máquina cargada: abrir
 * PGlite (el Postgres en WebAssembly) o correr las migraciones, y los que lanzan
 * un proceso aparte con `tsx` (los scripts de contraseña, de tweets y de datos
 * de ejemplo; el de contraseña además calcula un scrypt de 128 MB). Con dos
 * `npm run test` a la vez, o con los e2e corriendo, se pasaban de los 5 s por
 * defecto de Vitest y fallaban sin que nada estuviera roto. Las bases de prueba
 * ya se clonan de un molde migrado (`tests/helpers/db.ts`), pero el arranque en
 * frío de cada archivo y los procesos aparte no se pueden evitar: 30 s deja
 * margen de sobra y un test que de verdad se cuelga igual falla.
 */
const TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: TEST_TIMEOUT_MS,
    hookTimeout: TEST_TIMEOUT_MS,
  },
});
