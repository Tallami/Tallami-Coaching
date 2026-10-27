import { headers } from "next/headers";
import { after } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getAlertConfig, getAlertStatus, maskEmail } from "@/admin/alerts/config";
import { ENROLLMENT_CODE_MS, LOGIN_BLOCKED_ALERT_WINDOW_MS } from "@/admin/auth/policy";
import { LOGIN_WINDOW_MS } from "@/admin/auth/rate-limit";
import { notifySecurityEvent } from "@/admin/alerts/notify";
import { renderSecurityAlert, type AlertContext, type SecurityEvent } from "@/admin/alerts/render";
import { sendSecurityAlert } from "@/admin/alerts/send";

// Los avisos por email: qué dicen (`render.ts`), cuándo hay con qué mandarlos
// (`config.ts`), cómo se mandan sin romper nada (`send.ts`) y cómo se programan
// después de responder (`notify.ts`). Nada sale a la red: el transporte es un doble
// y el SDK de Resend, otro.

const sdk = vi.hoisted(() => ({ send: vi.fn(), keys: [] as string[] }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sdk.send };
    constructor(apiKey: string) {
      sdk.keys.push(apiKey);
    }
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

const API_KEY = "re_clave_de_prueba_muy_secreta";
const TO = "tomas@example.com";
const TEST_SENDER = "Panel de Tallami <onboarding@resend.dev>";
const AT = new Date("2026-10-21T03:30:00.000Z");
const GENERAL_ADVICE = "Si no fuiste vos: entrá y cerrá todas las sesiones, y cambiá la contraseña.";
/** Qué dice cada aviso que hay que hacer si no fue Tallami: donde "entrar" no sirve o no alcanza, otro consejo. */
const ADVICE: Record<SecurityEvent, string> = {
  login: GENERAL_ADVICE,
  // Una primera llave que él no registró: no tiene ninguna llave con la que entrar, y recuperar antes de cambiar la contraseña deja registrar de nuevo al otro.
  "first-passkey":
    "Si no fuiste vos: cambiá la contraseña y volvé a desplegar, después corré la recuperación de llaves y registrá la tuya enseguida.",
  "passkey-added": "Si no fuiste vos: entrá, borrá esa llave y cambiá la contraseña.",
  "passkey-removed": GENERAL_ADVICE,
  "code-generated": GENERAL_ADVICE,
  // Las sesiones ya se cerraron: lo que falta es mirar las llaves.
  "sessions-closed": "Si no fuiste vos: entrá, revisá las llaves en Configuración → Seguridad y cambiá la contraseña.",
  "login-blocked": GENERAL_ADVICE,
  // Borrar las llaves exige las credenciales de la base: hay que cambiarlas, y recién después registrar la llave propia.
  "passkeys-reset":
    "Si no fuiste vos: alguien llegó a la base de datos. Cambiá la contraseña del panel y la de la base, volvé a desplegar y registrá tu llave enseguida.",
};
const CONTEXT: AlertContext = { device: "Chrome en Windows", country: "AR" };

const EVENTS: SecurityEvent[] = [
  "login",
  "first-passkey",
  "passkey-added",
  "passkey-removed",
  "code-generated",
  "sessions-closed",
  "login-blocked",
  "passkeys-reset",
];

function configure({ from }: { from?: string } = {}): void {
  vi.stubEnv("RESEND_API_KEY", API_KEY);
  vi.stubEnv("ADMIN_ALERT_EMAIL", TO);
  vi.stubEnv("ADMIN_ALERT_FROM", from ?? "");
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("ADMIN_ALERT_EMAIL", "");
  vi.stubEnv("ADMIN_ALERT_FROM", "");
  sdk.send.mockReset();
  sdk.send.mockResolvedValue({ data: { id: "correo-1" }, error: null, headers: null });
  sdk.keys.length = 0;
  vi.mocked(after).mockReset();
  vi.mocked(headers).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getAlertConfig", () => {
  test("is null while the key or the address is missing, blank or not an address", () => {
    expect(getAlertConfig()).toBeNull();

    vi.stubEnv("RESEND_API_KEY", API_KEY);
    expect(getAlertConfig()).toBeNull();

    vi.stubEnv("ADMIN_ALERT_EMAIL", "   ");
    expect(getAlertConfig()).toBeNull();

    vi.stubEnv("ADMIN_ALERT_EMAIL", "esto no es un email");
    expect(getAlertConfig()).toBeNull();

    vi.stubEnv("RESEND_API_KEY", "  ");
    vi.stubEnv("ADMIN_ALERT_EMAIL", TO);
    expect(getAlertConfig()).toBeNull();
  });

  test("with the key and the address, sends from the Resend test address unless told otherwise", () => {
    configure();

    expect(getAlertConfig()).toEqual({ apiKey: API_KEY, to: TO, from: TEST_SENDER });

    vi.stubEnv("ADMIN_ALERT_FROM", "Panel <avisos@tallami.com>");
    expect(getAlertConfig()).toEqual({ apiKey: API_KEY, to: TO, from: "Panel <avisos@tallami.com>" });
  });
});

describe("the status of the alerts, for Configuración → Seguridad", () => {
  test("masks the address: the first letter and the domain, nothing else", () => {
    expect(maskEmail("tomas@gmail.com")).toBe("t***@gmail.com");
    expect(maskEmail("a@x.com")).toBe("a***@x.com");
  });

  test("is off when the variables are missing, never exposing the key", () => {
    expect(getAlertStatus()).toEqual({ kind: "off" });

    vi.stubEnv("RESEND_API_KEY", API_KEY);
    expect(getAlertStatus()).toEqual({ kind: "off" });

    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ADMIN_ALERT_EMAIL", TO);
    expect(getAlertStatus()).toEqual({ kind: "off" });
  });

  test("says where they go, masked, and whether the sender is Resend's test address", () => {
    configure();
    const status = getAlertStatus();

    expect(status).toEqual({ kind: "active", maskedEmail: "t***@example.com", usesTestSender: true });
    expect(JSON.stringify(status)).not.toContain(API_KEY);
    expect(JSON.stringify(status)).not.toContain("tomas@");

    vi.stubEnv("ADMIN_ALERT_FROM", "Panel <avisos@tallami.com>");
    expect(getAlertStatus()).toEqual({ kind: "active", maskedEmail: "t***@example.com", usesTestSender: false });
  });

  test("tells an address that is not valid apart from a missing one, naming the variable and never its value", () => {
    vi.stubEnv("RESEND_API_KEY", API_KEY);
    vi.stubEnv("ADMIN_ALERT_EMAIL", "tomas arroba gmail");

    const status = getAlertStatus();

    expect(status).toEqual({ kind: "invalid", variable: "ADMIN_ALERT_EMAIL" });
    expect(JSON.stringify(status)).not.toContain("tomas");
    expect(getAlertConfig()).toBeNull();
  });
});

describe("renderSecurityAlert", () => {
  test.each(EVENTS)("%s has a subject and a text in Spanish with what to do if it was not you", (event) => {
    const { subject, text, html } = renderSecurityAlert(event, CONTEXT, AT);

    expect(subject.length).toBeGreaterThan(10);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(text).toContain(ADVICE[event]);
    expect(html).toContain(ADVICE[event]);
    // Un solo consejo por aviso: el general no se suma al propio de cada evento.
    expect(text.match(/Si no fuiste vos:/g)).toHaveLength(1);
  });

  test("a first key he did not register is not told to sign in: he has no key to do it with, and recovering before changing the password lets the intruder register again", () => {
    const { text, html } = renderSecurityAlert("first-passkey", CONTEXT, AT);
    const advice = text.slice(text.indexOf("Si no fuiste vos:"));

    expect(advice).not.toContain("entrá");
    expect(advice).not.toContain("cerrá todas las sesiones");
    // El orden importa: contraseña, desplegar, recuperar y registrar la propia.
    const steps = ["cambiá la contraseña", "volvé a desplegar", "recuperación de llaves", "registrá la tuya enseguida"];
    const positions = steps.map((step) => advice.indexOf(step));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(steps.every((step) => html.includes(step))).toBe(true);
  });

  test("a key added that he did not add is deleted after signing in, not left to the general advice", () => {
    const { text } = renderSecurityAlert("passkey-added", CONTEXT, AT);

    expect(text).toContain("entrá, borrá esa llave");
    expect(text).not.toContain("cerrá todas las sesiones");
  });

  test("each event says what happened in its own words", () => {
    const text = (event: SecurityEvent) => renderSecurityAlert(event, CONTEXT, AT).text;

    expect(text("login")).toContain("Se ingresó al panel");
    expect(text("first-passkey")).toContain("primera llave de acceso");
    expect(text("passkey-added")).toContain("Se agregó una llave de acceso");
    expect(text("passkey-removed")).toContain("Se borró una llave de acceso");
    expect(text("code-generated")).toContain("Se generó un código");
    expect(text("sessions-closed")).toContain("Se cerraron todas las sesiones");
    expect(text("login-blocked")).toContain("Se bloquearon intentos de ingreso");
    expect(text("passkeys-reset")).toContain("Se borraron todas las llaves de acceso");
  });

  test("the code notice says how long the code lasts, and takes it from the policy: change the policy and the notice follows", async () => {
    const { text, html } = renderSecurityAlert("code-generated", CONTEXT, AT);
    expect(text).toContain(`Vence a los ${ENROLLMENT_CODE_MS / 60_000} minutos`);
    expect(html).toContain(`Vence a los ${ENROLLMENT_CODE_MS / 60_000} minutos`);

    vi.resetModules();
    vi.doMock("@/admin/auth/policy", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/admin/auth/policy")>()),
      ENROLLMENT_CODE_MS: 20 * 60 * 1000,
    }));
    try {
      const { renderSecurityAlert: renderWithOtherPolicy } = await import("@/admin/alerts/render");
      expect(renderWithOtherPolicy("code-generated", CONTEXT, AT).text).toContain("Vence a los 20 minutos");
    } finally {
      vi.doUnmock("@/admin/auth/policy");
      vi.resetModules();
    }
  });

  test("the block notice does not speak of one connection: it is the only one sent per window, whoever was blocked", () => {
    const { text } = renderSecurityAlert("login-blocked", CONTEXT, AT);

    expect(text).not.toContain("desde una conexión");
    expect(text).toContain(`${LOGIN_WINDOW_MS / 60_000} minutos`);
    expect(text).toContain("En la hora siguiente a este aviso no se manda otro aviso de bloqueo");
    expect(LOGIN_BLOCKED_ALERT_WINDOW_MS).toBe(60 * 60_000);
  });

  test("the subjects are all different, so each kind of notice is told apart in the inbox", () => {
    const subjects = EVENTS.map((event) => renderSecurityAlert(event, CONTEXT, AT).subject);

    expect(new Set(subjects).size).toBe(EVENTS.length);
  });

  test("shows the time in Argentina: 03:30 UTC is 00:30 of the same day", () => {
    const { text, html } = renderSecurityAlert("login", CONTEXT, AT);

    expect(text).toContain("21/10/2026 00:30");
    expect(html).toContain("21/10/2026 00:30");
    // Y un instante que en UTC ya es otro día.
    const lateAtNight = renderSecurityAlert("login", CONTEXT, new Date("2026-10-22T01:05:00.000Z")).text;
    expect(lateAtNight).toContain("21/10/2026 22:05");
  });

  test("shows the device and the country by name", () => {
    const { text, html } = renderSecurityAlert("login", { device: "Safari en iPhone", country: "BR" }, AT);

    expect(text).toContain("Safari en iPhone");
    expect(text).toContain("Brasil (BR)");
    expect(html).toContain("Safari en iPhone");
    expect(html).toContain("Brasil (BR)");
  });

  test("says unknown country when the request did not say", () => {
    const { text, html } = renderSecurityAlert("login", { device: "Chrome en Windows", country: null }, AT);

    expect(text).toContain("país desconocido");
    expect(html).toContain("país desconocido");
  });

  test("shows the name of the key when there is one, and no line for it when there is not", () => {
    const named = renderSecurityAlert("passkey-added", { ...CONTEXT, passkeyName: "Celular de Tomás" }, AT);
    const unnamed = renderSecurityAlert("passkey-added", CONTEXT, AT);

    expect(named.text).toContain("Llave: Celular de Tomás");
    expect(named.html).toContain("Celular de Tomás");
    expect(unnamed.text).not.toContain("Llave:");
  });

  test("the html shows a key name as text, never as markup", () => {
    const { text, html } = renderSecurityAlert(
      "passkey-added",
      { device: "Chrome <b>en</b> Windows & más", country: null, passkeyName: '<script>alert("x")</script>' },
      AT,
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("Chrome &lt;b&gt;en&lt;/b&gt; Windows &amp; más");
    // El texto plano no interpreta nada: lleva el nombre tal cual.
    expect(text).toContain('<script>alert("x")</script>');
  });

  test("a key name cannot add lines to the text", () => {
    const { text } = renderSecurityAlert(
      "passkey-added",
      { ...CONTEXT, passkeyName: "Celular\r\n\r\nEntrá en https://falso.example" },
      AT,
    );

    expect(text).toContain("Llave: Celular Entrá en https://falso.example");
  });

  test("never has a link to sign in, a code or a password", () => {
    for (const event of EVENTS) {
      const { text, html } = renderSecurityAlert(event, CONTEXT, AT);

      expect(text).not.toMatch(/https?:|www\./i);
      expect(html).not.toMatch(/https?:|www\.|<a[\s>]|href=/i);
    }
  });
});

describe("sendSecurityAlert", () => {
  test("hands the rendered notice to the transport, from and to the configured addresses", async () => {
    configure();
    const transport = vi.fn().mockResolvedValue(undefined);

    await sendSecurityAlert("passkey-removed", { ...CONTEXT, passkeyName: "Notebook" }, { transport, now: AT });

    const rendered = renderSecurityAlert("passkey-removed", { ...CONTEXT, passkeyName: "Notebook" }, AT);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith({ from: TEST_SENDER, to: TO, ...rendered });
  });

  test("with an address that is not valid it sends nothing and says which variable to fix, not its value", async () => {
    vi.stubEnv("RESEND_API_KEY", API_KEY);
    vi.stubEnv("ADMIN_ALERT_EMAIL", "no-es-un-email-valido");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = vi.fn().mockResolvedValue(undefined);

    await sendSecurityAlert("login", CONTEXT, { transport });

    expect(transport).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledOnce();
    const output = JSON.stringify(logged.mock.calls);
    expect(output).toContain("ADMIN_ALERT_EMAIL");
    expect(output).not.toContain("no-es-un-email-valido");
    expect(output).not.toContain(API_KEY);
  });

  test("sends nothing, and does not even build the notice, without configuration", async () => {
    const transport = vi.fn().mockResolvedValue(undefined);

    await sendSecurityAlert("login", CONTEXT, { transport });

    expect(transport).not.toHaveBeenCalled();
    expect(sdk.send).not.toHaveBeenCalled();
  });

  test("a transport that throws does not make it throw: it is logged, with nothing sensitive", async () => {
    configure();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = vi.fn().mockRejectedValue(new Error("se cayó la red"));

    await expect(sendSecurityAlert("login", { ...CONTEXT, passkeyName: "Celular" }, { transport })).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledOnce();
    const output = JSON.stringify(logged.mock.calls, (_key, value) =>
      value instanceof Error ? `${value.name}: ${value.message}` : value,
    );
    expect(output).toContain("login");
    expect(output).toContain("se cayó la red");
    expect(output).not.toContain(API_KEY);
    expect(output).not.toContain(TO);
    expect(output).not.toContain("Celular");
    expect(output).not.toContain("Chrome en Windows");
  });

  test("a transport that throws something that is not an error is also only logged", async () => {
    configure();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = vi.fn().mockRejectedValue("texto suelto");

    await expect(sendSecurityAlert("login", CONTEXT, { transport })).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledOnce();
  });

  test("by default it sends through Resend with the key, as a plain notice with an html twin", async () => {
    configure();

    await sendSecurityAlert("sessions-closed", CONTEXT, { now: AT });

    expect(sdk.keys).toEqual([API_KEY]);
    expect(sdk.send).toHaveBeenCalledOnce();
    const rendered = renderSecurityAlert("sessions-closed", CONTEXT, AT);
    expect(sdk.send).toHaveBeenCalledWith({ from: TEST_SENDER, to: TO, ...rendered });
  });

  test("an answer with an error from Resend is logged by its name and status, without its text", async () => {
    configure();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: `Solo podés enviar a ${TO} con la clave ${API_KEY}` },
      headers: null,
    });

    await expect(sendSecurityAlert("login", CONTEXT)).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledOnce();
    const output = JSON.stringify(logged.mock.calls, (_key, value) =>
      value instanceof Error ? `${value.name}: ${value.message}` : value,
    );
    expect(output).toContain("validation_error");
    expect(output).toContain("403");
    expect(output).not.toContain(TO);
    expect(output).not.toContain(API_KEY);
  });

  test("Resend throwing is only logged too", async () => {
    configure();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.send.mockRejectedValue(new Error("fetch failed"));

    await expect(sendSecurityAlert("login", CONTEXT)).resolves.toBeUndefined();

    expect(logged).toHaveBeenCalledOnce();
  });
});

describe("notifySecurityEvent", () => {
  /** Las funciones que Next guardó con `after()`: se corren a mano, cuando el test quiere. */
  function scheduled(): Array<() => Promise<void>> {
    return vi.mocked(after).mock.calls.map(([task]) => task as () => Promise<void>);
  }

  function requestWith(values: Record<string, string>): void {
    vi.mocked(headers).mockResolvedValue(new Headers(values) as never);
  }

  const CHROME_WINDOWS =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

  test("only schedules: nothing is read or sent until the response is out", async () => {
    configure();
    requestWith({ "user-agent": CHROME_WINDOWS });

    const result = notifySecurityEvent("login");

    expect(result).toBeUndefined();
    expect(scheduled()).toHaveLength(1);
    expect(headers).not.toHaveBeenCalled();
    expect(sdk.send).not.toHaveBeenCalled();
  });

  test("when it runs, it takes the device from the user agent and the country from Vercel's header", async () => {
    configure();
    requestWith({ "user-agent": CHROME_WINDOWS, "x-vercel-ip-country": "AR" });

    notifySecurityEvent("login");
    await scheduled()[0]();

    expect(sdk.send).toHaveBeenCalledOnce();
    const [message] = sdk.send.mock.calls[0];
    expect(message).toMatchObject({ from: TEST_SENDER, to: TO });
    expect(message.subject).toBe(renderSecurityAlert("login", CONTEXT, new Date()).subject);
    expect(message.text).toContain("Chrome en Windows");
    expect(message.text).toContain("Argentina (AR)");
  });

  test("what the caller adds, like the name of a key, goes in the notice", async () => {
    configure();
    requestWith({ "user-agent": CHROME_WINDOWS });

    notifySecurityEvent("passkey-added", { passkeyName: "Notebook" });
    await scheduled()[0]();

    expect(sdk.send.mock.calls[0][0].text).toContain("Llave: Notebook");
  });

  test("a country header that is not two letters is ignored: it ends up in the email", async () => {
    configure();
    requestWith({ "user-agent": CHROME_WINDOWS, "x-vercel-ip-country": "<b>Argentina</b>" });

    notifySecurityEvent("login");
    await scheduled()[0]();

    expect(sdk.send.mock.calls[0][0].text).toContain("país desconocido");
  });

  test("without a user agent or a country, the notice says so instead of failing", async () => {
    configure();
    requestWith({});

    notifySecurityEvent("login");
    await scheduled()[0]();

    const { text } = sdk.send.mock.calls[0][0];
    expect(text).toContain("Navegador desconocido");
    expect(text).toContain("país desconocido");
  });

  test("if the request headers cannot be read, it still sends, with the unknown device, and logs why by the error's name", async () => {
    configure();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(headers).mockRejectedValue(new TypeError("fuera de un pedido, cookie=secreta"));

    notifySecurityEvent("login");
    await scheduled()[0]();

    expect(sdk.send.mock.calls[0][0].text).toContain("Navegador desconocido");
    expect(logged).toHaveBeenCalledOnce();
    const output = JSON.stringify(logged.mock.calls);
    expect(output).toContain("TypeError");
    expect(output).not.toContain("secreta");
    expect(output).not.toContain("fuera de un pedido");
  });

  test("a failure to send does not escape the scheduled task", async () => {
    configure();
    vi.spyOn(console, "error").mockImplementation(() => {});
    requestWith({ "user-agent": CHROME_WINDOWS });
    sdk.send.mockRejectedValue(new Error("fetch failed"));

    notifySecurityEvent("login");

    await expect(scheduled()[0]()).resolves.toBeUndefined();
  });

  test("outside a request Next cannot schedule: it is logged and nothing breaks", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(after).mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });

    expect(() => notifySecurityEvent("login")).not.toThrow();
    expect(logged).toHaveBeenCalledOnce();
  });
});
