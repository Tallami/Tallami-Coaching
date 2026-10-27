import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { RESET_CONFIRMATION } from "../../scripts/admin-reset-passkeys";

// La pantalla del paso de la llave manda a Tallami a "la guía de recuperación del README":
// si el título cambia o se borra, esa frase queda mandando a ninguna parte. Y la guía
// tiene que decir lo mismo que el comando: el nombre del script y la frase que pide.

const README = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const PASSKEY_STEP = readFileSync(new URL("../../src/components/admin/passkey-step.tsx", import.meta.url), "utf8");
const PACKAGE = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

/** El texto de la sección que empieza en el título `heading` (un `###`), hasta el siguiente título del mismo nivel o mayor. */
function sectionOf(heading: string): string {
  const start = README.indexOf(`\n### ${heading}\n`);
  if (start === -1) throw new Error(`El README no tiene la sección "${heading}".`);
  const rest = README.slice(start + 1);
  const next = rest.slice(1).search(/\n#{1,3} /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("the recovery guide of the README", () => {
  test("exists under the name the login page points to", () => {
    expect(PASSKEY_STEP).toMatch(/guía de recuperación del README/);
    expect(README).toMatch(/^### Guía de recuperación$/m);
  });

  test("tells the command that exists and the phrase it asks for", () => {
    const guide = sectionOf("Guía de recuperación");

    expect(PACKAGE.scripts["admin:reset-passkeys"]).toBe("tsx scripts/admin-reset-passkeys.ts");
    expect(guide).toContain("npm run admin:reset-passkeys");
    expect(guide).toContain(`\`${RESET_CONFIRMATION}\``);
  });

  test("says where to get the connection string without sending him to Vercel, which does not show it once saved as a Secret", () => {
    const guide = sectionOf("Guía de recuperación");
    const step = guide.slice(guide.indexOf("\n1. "), guide.indexOf("\n2. "));

    // La sección de cuentas manda guardar `DATABASE_URL` como «Secret»: en Vercel no se puede volver a leer.
    expect(sectionOf("Seguridad de tus cuentas")).toContain("ya no se puede ver");
    expect(step).not.toMatch(/`DATABASE_URL` en Vercel/);
    // De dónde sale: de su administrador de contraseñas, o de Supabase (Connect), como en "Ponerlo en línea".
    expect(step).toContain("administrador de contraseñas");
    expect(step).toContain("Connect");
    expect(step).toContain("[YOUR-PASSWORD]");
  });

  test("names the Supabase connection strings that work for the command and why", () => {
    const guide = sectionOf("Guía de recuperación");
    const step = guide.slice(guide.indexOf("\n1. "), guide.indexOf("\n2. "));

    // La de las migraciones (directa o pooler de sesión) y también la del pooler de transacciones.
    expect(step).toContain("Direct connection");
    expect(step).toContain("Session pooler");
    expect(step).toContain("Transaction pooler");
    expect(step).toMatch(/sin sentencias preparadas/);
  });

  test("covers losing one device, losing all of them and changing the domain", () => {
    const guide = sectionOf("Guía de recuperación");

    expect(guide).toMatch(/Perdiste un dispositivo/);
    expect(guide).toMatch(/Perdiste todos los dispositivos/);
    expect(guide).toMatch(/La dirección de la web/);
  });
});

describe("the security sections of the README", () => {
  test.each([
    ["Entrar con contraseña y llave de acceso", "PIN de Windows Hello"],
    ["Avisos por email (Resend)", "RESEND_API_KEY"],
    ["Seguridad de tus cuentas", "segundo factor"],
  ])("«%s» exists and covers %s", (heading, topic) => {
    expect(sectionOf(heading)).toContain(topic);
  });

  test("every link points to the official page of the service it talks about", () => {
    const text = [
      sectionOf("Entrar con contraseña y llave de acceso"),
      sectionOf("Avisos por email (Resend)"),
      sectionOf("Seguridad de tus cuentas"),
    ].join("\n");
    const hosts = [...text.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map(([, url]) => new URL(url).hostname);

    expect(new Set(hosts)).toEqual(
      new Set([
        "support.microsoft.com",
        "resend.com",
        "docs.github.com",
        "vercel.com",
        "supabase.com",
        "support.google.com",
      ]),
    );
  });

  test("the env example lists the variables of the alerts and the test origin", () => {
    const example = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");

    for (const name of ["RESEND_API_KEY", "ADMIN_ALERT_EMAIL", "ADMIN_ALERT_FROM", "ADMIN_WEBAUTHN_ORIGIN"]) {
      expect(example, name).toMatch(new RegExp(`^#? ?${name}=`, "m"));
    }
  });
});

describe("the README on the address of the keys", () => {
  /** El paso 5 de "Ponerlo en línea": las variables de Vercel. */
  function variablesStep(): string {
    const online = sectionOf("Ponerlo en línea");
    return online.slice(online.indexOf("\n5. "), online.indexOf("\n6. "));
  }

  test("makes NEXT_PUBLIC_SITE_URL mandatory for the panel, equal to where the browser ends up after the www redirect", () => {
    const step = variablesStep();

    expect(step).toContain("`NEXT_PUBLIC_SITE_URL`");
    expect(step).toMatch(/obligatoria/);
    expect(step).toContain("`www`");
    expect(step).toMatch(/redirecci[oó]n/);
    expect(step).toContain("Las llaves solo funcionan en");
  });

  test("warns that adding a domain without the variable moves the keys at the next deploy, and how to recover", () => {
    const step = variablesStep();

    expect(step).toContain("dominio de producción");
    expect(step).toMatch(/siguiente despliegue/);
    expect(step).toContain("npm run admin:reset-passkeys");
  });

  test("does not name buttons of Vercel that the guide cannot vouch for", () => {
    const step = variablesStep();

    expect(step).not.toMatch(/«(Add|Domains?|Add Domain|Redirect)[^»]*»/i);
  });
});

describe("the README on what to do when a notice was not him", () => {
  test("both first-key steps of the deploy say to register the key right away", () => {
    const ready = sectionOf("Dejarlo listo");
    const firstKey = ready.slice(ready.indexOf("\n5. "));
    const online = sectionOf("Ponerlo en línea");
    const upgrade = online.slice(online.indexOf("Si ya tenías el panel en línea"));
    const upgradeFirstKey = upgrade.slice(upgrade.indexOf("\n4. "), upgrade.indexOf("\n\n", upgrade.indexOf("\n4. ") + 1));

    expect(firstKey).toMatch(/registrar la primera en ese mismo dispositivo[^\n]*enseguida|enseguida[^\n]*primera/);
    expect(upgradeFirstKey).toContain("enseguida");
  });

  test("tells him what to do for a first key he did not register: password, deploy, then the recovery, then his own key", () => {
    const guide = sectionOf("Guía de recuperación");
    const bullet = guide.split("\n").find((line) => /Primera llave/.test(line) && /no registraste/.test(line));

    expect(bullet, "falta el consejo de la primera llave").toBeDefined();
    const steps = ["cambiá la contraseña", "volvé a desplegar", "npm run admin:reset-passkeys", "enseguida"];
    const positions = steps.map((step) => bullet!.indexOf(step));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Sin ninguna llave no hay con qué entrar: no se le manda a "entrar y cerrar sesiones".
    expect(bullet).not.toContain("cerrá todas las sesiones");
  });

  test("tells him to delete a key he did not add, and to change the database credentials when the keys were wiped", () => {
    const guide = sectionOf("Guía de recuperación");

    expect(guide).toMatch(/Llave agregada[^\n]*entrá, borrá esa llave[^\n]*cambiá la contraseña/);
    expect(guide).toMatch(/Se borraron las llaves[^\n]*base de datos/);
  });
});

describe("the README on the notice of a blocked connection", () => {
  test("says it goes out at most once an hour, as the policy says", () => {
    const alerts = sectionOf("Avisos por email (Resend)");

    expect(alerts).toContain("uno por hora como mucho");
    expect(alerts).not.toContain("uno cada 15 minutos");
  });
});

describe("the README on what it promises exactly", () => {
  test("the recovery of what he was typing is only what he was saving, in that same tab", () => {
    const login = sectionOf("Entrar con contraseña y llave de acceso");

    expect(login).not.toContain("Lo que estabas escribiendo en un formulario se recupera");
    expect(login).toMatch(/lo que estabas guardando se recupera/);
    expect(login).toMatch(/en esa misma pestaña/);
    expect(login).toMatch(/sin guardar[^.]*no se recupera/);
  });

  test("recovery step 2 tells him to check the postgres.<code> user, because the pooler servers are regional", () => {
    const guide = sectionOf("Guía de recuperación");
    const step = guide.slice(guide.indexOf("\n2. "), guide.indexOf("\n3. "));

    expect(step).toContain("`postgres.");
    expect(step).toMatch(/usuario/);
    expect(step).toMatch(/regi[oó]n/);
  });

  test("in Git Bash the command is always run with the phrase piped in, never bare", () => {
    const guide = sectionOf("Guía de recuperación");
    const bashBlocks = [...guide.matchAll(/```bash\n([\s\S]*?)```/g)].map(([, block]) => block);
    const runs = bashBlocks.flatMap((block) => block.split("\n")).filter((line) => line.includes("npm run admin:reset-passkeys"));

    expect(runs.length).toBeGreaterThan(0);
    for (const line of runs) expect(line.trim(), line).toMatch(/^echo "[^"]*" \| npm run admin:reset-passkeys/);
    expect(guide).toContain(`echo "${RESET_CONFIRMATION}" | npm run admin:reset-passkeys`);
  });

  test("a local reset asks to close npm run dev first: the local database allows one program at a time", () => {
    const guide = sectionOf("Guía de recuperación");
    const local = guide.slice(guide.indexOf("Sin `DATABASE_URL`"));

    expect(local).toContain("`npm run dev`");
    expect(local).toMatch(/un solo programa|dos programas/);
  });
});
