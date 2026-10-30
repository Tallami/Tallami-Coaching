import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import es from "../../messages/es.json";
import { MIN_PORTAL_SECRET_LENGTH } from "@/portal/config";
import { CANONICAL_REDIRECT_PARAM, redirectUriFor } from "@/portal/oauth/providers";
import {
  DELIVERY_PDF_MAX_BYTES,
  PORTAL_INVITE_MS,
  PORTAL_RECORD_RETENTION_MS,
  PORTAL_SESSION_MS,
} from "@/portal/policy";

// La guía "Portal del alumno" del README es lo único que Tallami tiene para dejar el portal
// andando: las variables que carga en Vercel, las direcciones que registra en Discord y en
// Google y los pasos para invitar a un alumno y cargar entregas. Estos tests la atan al código:
// los nombres, las rutas, los números y el comando que genera el secreto tienen que ser los
// de verdad, y no puede mandar a ninguna página que no sea la oficial del servicio.

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const ENV_EXAMPLE = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
const MIGRATIONS = readdirSync(new URL("../../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql"));

/** El texto de la sección que empieza en el título `heading` (un `##`), hasta el siguiente `##`. */
function sectionOf(heading: string): string {
  const start = README.indexOf(`\n## ${heading}\n`);
  if (start === -1) throw new Error(`El README no tiene la sección "${heading}".`);
  const rest = README.slice(start + 1);
  const next = rest.slice(1).search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** El texto de la subsección `heading` (un `###`) de la guía del portal, hasta el siguiente título `###` o `##`. */
function subsectionOf(heading: string): string {
  const guide = sectionOf("Portal del alumno");
  const start = guide.indexOf(`\n### ${heading}\n`);
  if (start === -1) throw new Error(`La guía del portal no tiene la subsección "${heading}".`);
  const rest = guide.slice(start + 1);
  const next = rest.slice(1).search(/\n#{2,3} /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const GUIDE = sectionOf("Portal del alumno");

const VARIABLES = [
  "PORTAL_SESSION_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

describe("the portal guide of the README", () => {
  test("sits between the panel and the deploy sections, with its own steps", () => {
    expect(README.indexOf("\n## Panel de admin\n")).toBeLessThan(README.indexOf("\n## Portal del alumno\n"));
    expect(README.indexOf("\n## Portal del alumno\n")).toBeLessThan(README.indexOf("\n## Deploy (Vercel)\n"));
    for (const heading of [
      "Dejarlo listo",
      "Probarlo después de desplegar",
      "Invitar a un alumno",
      "Cargar entregas",
      "Qué se guarda de cada alumno",
      "Probarlo en tu compu",
    ]) {
      expect(() => subsectionOf(heading), heading).not.toThrow();
    }
  });

  test.each(VARIABLES)("names the variable %s that goes in Vercel", (name) => {
    expect(subsectionOf("Dejarlo listo")).toContain(`\`${name}\``);
  });

  test("tells where to register the two return addresses, and they are the real routes of the sign-in", () => {
    const setup = subsectionOf("Dejarlo listo");

    for (const provider of ["discord", "google"] as const) {
      const { pathname } = new URL(redirectUriFor(provider, "https://ejemplo.test"));
      expect(pathname).toBe(`/api/portal/auth/${provider}/callback`);
      expect(setup, provider).toContain(`https://<tu-dominio>${pathname}`);
    }
  });

  test("builds the return addresses from NEXT_PUBLIC_SITE_URL, the one after the www redirect", () => {
    const setup = subsectionOf("Dejarlo listo");

    expect(setup).toContain("`NEXT_PUBLIC_SITE_URL`");
    expect(setup).toMatch(/redirecci[oó]n/);
    expect(setup).toContain("`www`");
    // Las vistas previas de Vercel tienen otra dirección que no está registrada: no sirven para entrar.
    expect(setup).toMatch(/vista previa|vistas previas/);
  });

  test("explains the marker of the redirect to the public address and the 404 that cuts a loop", () => {
    expect(GUIDE).toContain(`?${CANONICAL_REDIRECT_PARAM}=1`);
    expect(subsectionOf("Probarlo después de desplegar")).toMatch(/404/);
  });

  test("lists the headers of the PDF response, the sandbox one included", () => {
    expect(GUIDE).toContain("`Content-Security-Policy: sandbox`");
  });

  test("tells to run db:migrate before deploying, and names the migration that adds the tables", () => {
    const setup = subsectionOf("Dejarlo listo");
    const migration = MIGRATIONS.find((name) => name.startsWith("0006_"));

    expect(migration, "la migración 0006 existe").toBeDefined();
    expect(setup).toContain("npm run db:migrate");
    expect(setup).toContain("0006");
    // Las tablas primero, y recién después el paso de desplegar.
    expect(setup.indexOf("npm run db:migrate")).toBeLessThan(setup.indexOf("**Desplegar.**"));
    expect(setup).toMatch(/Antes de desplegar/);
  });

  test("gives a command that really produces a secret of the minimum length", () => {
    const command = /node -e "([^"]+)"/.exec(subsectionOf("Dejarlo listo"));
    expect(command, "el comando para generar el secreto").not.toBeNull();

    const secret = execFileSync(process.execPath, ["-e", command?.[1] ?? ""], { encoding: "utf8" }).trim();

    expect(secret.length).toBeGreaterThanOrEqual(MIN_PORTAL_SECRET_LENGTH);
    expect(subsectionOf("Dejarlo listo")).toContain(`${MIN_PORTAL_SECRET_LENGTH} caracteres`);
  });

  test("explains when a provider button shows up and what the portal says without configuration", () => {
    const setup = subsectionOf("Dejarlo listo");

    // (Con negrita en la guía: «**las dos** variables».)
    expect(setup).toMatch(/las dos\W+variables de ese proveedor/);
    expect(setup).toMatch(/botón/);
    // El aviso es el texto de verdad de la página, en español.
    expect(setup).toContain(`«${es.Portal.unavailable.title}»`);
  });

  test("covers the invitation: the student page of the panel, the language, the one-time link and its expiry", () => {
    const invite = subsectionOf("Invitar a un alumno");

    expect(invite).toContain("Invitar al portal");
    expect(invite).toContain("Idioma del link");
    expect(invite).toContain("Copiar link");
    expect(invite).toContain(`${PORTAL_INVITE_MS / (24 * 60 * 60 * 1000)} días`);
    expect(invite).toContain("Desvincular");
    expect(invite).toContain("Borrar cuenta del portal");
  });

  test("covers the three kinds of delivery with the real limit, and warns about the database space", () => {
    const deliveries = subsectionOf("Cargar entregas");

    expect(deliveries).toContain("no listado");
    expect(deliveries).toContain(`${DELIVERY_PDF_MAX_BYTES / (1024 * 1024)} MB`);
    expect(deliveries).toContain("Google Drive");
    expect(deliveries).toContain("https://supabase.com/docs/guides/platform/database-size");
    expect(deliveries).toContain("https://supabase.com/pricing");
    // Por qué el techo de las Server Actions es de 5 MB y vale para todas (el comentario de `next.config.ts` lo explica).
    expect(deliveries).toContain("bodySizeLimit");
  });

  test("lists what is kept about each student, and says the privacy policy is pending", () => {
    const data = subsectionOf("Qué se guarda de cada alumno");

    for (const item of ["proveedor", "nombre para mostrar", "email", "verificado"]) expect(data, item).toContain(item);
    expect(data).toMatch(/política de privacidad/);
    expect(data).toMatch(/investigación legal/);
  });

  test("says how long an account that is not linked stays, and what the panel deletes", () => {
    const data = subsectionOf("Qué se guarda de cada alumno");
    const days = (PORTAL_SESSION_MS + PORTAL_RECORD_RETENTION_MS) / (24 * 60 * 60 * 1000);

    expect(days).toBe(31);
    expect(data).toMatch(new RegExp(`cuenta[^.]*sin vincular[^.]*${days} días[^.]*último ingreso`, "i"));
    expect(data).toContain("Borrar cuenta del portal");
  });

  test("limits `nothing outside this list` to the database: the hosting provider keeps its own request logs", () => {
    const data = subsectionOf("Qué se guarda de cada alumno");

    expect(data).toMatch(/no guarda nada en la base de datos fuera de esta lista/);
    expect(data).toMatch(/hosting[^.]*registros/);
    expect(data).not.toMatch(/no guarda nada fuera de esta lista/);
  });

  test("tells students to open the link in the real browser of the phone, not in the in-app browser of a social network, with Google's own pages", () => {
    const invite = subsectionOf("Invitar a un alumno");

    expect(invite).toMatch(/Chrome/);
    expect(invite).toMatch(/Safari/);
    for (const app of ["Instagram", "TikTok", "Discord"]) expect(invite, app).toContain(app);
    expect(invite).toContain("https://support.google.com/accounts/answer/7675428");
    expect(invite).toContain("https://developers.google.com/identity/protocols/oauth2/policies");
  });

  test("the test purchase of the smoke test does not claim it adds to no number of the panel", () => {
    const smoke = subsectionOf("Probarlo después de desplegar");

    expect(smoke).not.toContain("no suma en ningún número del panel");
    expect(smoke).toMatch(/no cuenta como ingreso/);
    expect(smoke).toMatch(/sin fecha/);
  });

  test("teaches the development sign-in with the mock server, and says it never goes to Vercel", () => {
    const local = subsectionOf("Probarlo en tu compu");

    expect(local).toContain("PORTAL_OAUTH_TEST_ISSUER");
    expect(local).toContain("tests/helpers/mock-oauth-server.mjs");
    expect(local).toMatch(/solo para desarrollo/i);
    expect(local).toMatch(/nunca en Vercel/i);
    // Se ignora en todo Vercel (`VERCEL`), no solo en producción: también en las vistas previas.
    expect(local).toMatch(/en cualquier entorno \(producción y vista previa\)/);
    expect(local).toContain(es.Portal.providers.test.button);
  });

  test("has a short smoke test for after the deploy: the page, both sign-ins and the www redirect", () => {
    const smoke = subsectionOf("Probarlo después de desplegar");

    expect(smoke).toContain("/es/portal");
    expect(smoke).toContain(es.Portal.signIn.title);
    expect(smoke).toContain(es.Portal.unlinked.title);
    expect(smoke).toContain("Discord");
    expect(smoke).toContain("Google");
    expect(smoke).toContain("`NEXT_PUBLIC_SITE_URL`");
  });

  test("every link points to the official page of the service it talks about", () => {
    const hosts = [...GUIDE.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map(([, url]) => new URL(url).hostname);

    expect(new Set(hosts)).toEqual(
      new Set([
        "discord.com",
        "docs.discord.com",
        "console.cloud.google.com",
        "developers.google.com",
        "support.google.com",
        "supabase.com",
        "vercel.com",
      ]),
    );
  });
});

describe(".env.example", () => {
  test.each(VARIABLES)("lists %s without a value", (name) => {
    expect(ENV_EXAMPLE).toMatch(new RegExp(`^${name}=$`, "m"));
  });

  test("lists PORTAL_OAUTH_TEST_ISSUER commented out and marked as only for tests and development", () => {
    expect(ENV_EXAMPLE).toMatch(/^# PORTAL_OAUTH_TEST_ISSUER=\S+$/m);
    expect(ENV_EXAMPLE).not.toMatch(/^PORTAL_OAUTH_TEST_ISSUER=/m);
    const line = ENV_EXAMPLE.slice(0, ENV_EXAMPLE.indexOf("# PORTAL_OAUTH_TEST_ISSUER="));
    expect(line.slice(-600)).toMatch(/SOLO para tests y desarrollo/);
  });

  test("its example for the test server is the port that the mock server listens on by default", () => {
    const mock = readFileSync(new URL("../helpers/mock-oauth-server.mjs", import.meta.url), "utf8");
    const port = /MOCK_OAUTH_PORT \?\? (\d+)/.exec(mock)?.[1];

    expect(port).toBeDefined();
    expect(ENV_EXAMPLE).toContain(`# PORTAL_OAUTH_TEST_ISSUER=http://localhost:${port}`);
  });
});
