import { describe, expect, test } from "vitest";
import { SALE_ITEMS, SALE_STATUSES } from "@/admin/catalog";
import { DELIVERY_KINDS, PORTAL_PROVIDERS } from "@/portal/policy";
import { NOTICE_KEYS } from "@/portal/page-state";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import pt from "../../messages/pt.json";

// La página del alumno está en los tres idiomas del sitio. `messages.test.ts` ya cuida que todo el
// catálogo tenga las mismas claves; acá se cuida lo del portal en particular: que el namespace
// `Portal` exista completo, que cada lista cerrada (servicios, estados, proveedores, tipos de
// entrega, avisos) tenga su texto, y que pt y en no sean el español copiado.

type Messages = { [key: string]: string | Messages };

function flatten(messages: Messages, prefix = ""): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value] as [string, string]] : flatten(value, path);
  });
}

const catalogs = [
  ["es", es],
  ["pt", pt],
  ["en", en],
] as const;

function portalOf(messages: { Portal: Messages }): Map<string, string> {
  return new Map(flatten(messages.Portal));
}

/** Nombres de los argumentos ICU de un mensaje (`{date}`), sin repetir. */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((match) => match[1]))].sort();
}

/** Textos que son iguales en los tres idiomas porque son nombres propios, siglas o palabras que no se traducen. */
const SAME_IN_EVERY_LANGUAGE = new Set([
  "providers.discord.name",
  "providers.google.name",
  "items.proSeason",
  "deliveries.kinds.youtube",
  "deliveries.kinds.pdf",
  "deliveries.kinds.link",
  "deliveries.viewPdf",
]);

/** Textos que en portugués se escriben igual que en español. */
const SAME_IN_PORTUGUESE = new Set([
  "deliveries.title",
  "deliveries.openLink",
  "signIn.providersLabel",
  "status.cancelled",
  "status.refunded",
]);

describe("Portal messages", () => {
  test.each(catalogs)("%s has the Portal namespace, and the Footer link to it", (_locale, messages) => {
    expect(portalOf(messages).size).toBeGreaterThan(20);
    expect(messages.Footer.portal.trim().length).toBeGreaterThan(0);
  });

  test("pt and en have exactly the keys of es, in the Portal namespace and in the Footer", () => {
    const spanish = [...portalOf(es).keys()].sort();

    expect([...portalOf(pt).keys()].sort()).toEqual(spanish);
    expect([...portalOf(en).keys()].sort()).toEqual(spanish);
  });

  test("pt and en use the same ICU arguments as es in every Portal message", () => {
    for (const [path, message] of portalOf(es)) {
      for (const [locale, messages] of [
        ["pt", pt],
        ["en", en],
      ] as const) {
        expect(placeholders(portalOf(messages).get(path) ?? ""), `${locale}: ${path}`).toEqual(placeholders(message));
      }
    }
  });

  test("the messages that take an argument declare the one the page passes", () => {
    const spanish = portalOf(es);

    expect(placeholders(spanish.get("purchases.paidOn") ?? "")).toEqual(["date"]);
    expect(placeholders(spanish.get("deliveries.addedOn") ?? "")).toEqual(["date"]);
    expect(placeholders(spanish.get("account.signedInWith") ?? "")).toEqual(["provider"]);
    expect(placeholders(spanish.get("account.greeting") ?? "")).toEqual(["name"]);
  });

  test.each(catalogs)("%s has no empty message and no price written in a message", (_locale, messages) => {
    for (const [path, message] of portalOf(messages)) {
      expect(message.trim().length, path).toBeGreaterThan(0);
      expect(message, path).not.toMatch(/USD\s*\d|\$\s*\d/);
    }
  });

  test.each(catalogs)("%s names every service, status, provider, kind of delivery and notice the page can show", (_l, messages) => {
    const portal = portalOf(messages);
    const needed = [
      ...SALE_ITEMS.map((item) => `items.${item}`),
      ...SALE_STATUSES.map((status) => `status.${status}`),
      ...PORTAL_PROVIDERS.flatMap((provider) => [`providers.${provider}.name`, `providers.${provider}.button`]),
      ...DELIVERY_KINDS.map((kind) => `deliveries.kinds.${kind}`),
      ...NOTICE_KEYS.map((key) => `notices.${key}`),
    ];

    for (const key of needed) expect(portal.has(key), key).toBe(true);
  });

  test("the sign-in of the test provider says plainly that it is a test account", () => {
    expect(portalOf(es).get("providers.test.button")).toMatch(/prueba/i);
    expect(portalOf(pt).get("providers.test.button")).toMatch(/teste/i);
    expect(portalOf(en).get("providers.test.button")).toMatch(/test/i);
  });

  test("the unlinked account is told what to do, in the words of the design", () => {
    expect(portalOf(es).get("unlinked.body")).toBe("Tu cuenta todavía no está vinculada. Pedile a Tallami tu invitación.");
  });

  test("the notice for an account that is already linked reads as neutral, not as an error", () => {
    expect(portalOf(es).get("notices.alreadyLinked")).toBe("Tu cuenta ya está vinculada.");
  });

  test("the notice for a linked account that opens an invitation link says the account is already linked and what to do if the invitation is for another one, in every language", () => {
    // No sabe de quién es la invitación (sin consultar la base): sirve tanto para la propia ya usada como para la de otra cuenta.
    expect(portalOf(es).get("notices.inviteOtherAccount")).toBe(
      "Tu cuenta ya está vinculada. Si esta invitación es para otra cuenta, salí y entrá con esa.",
    );
    expect(portalOf(pt).get("notices.inviteOtherAccount")).toBe(
      "A sua conta já está vinculada. Se este convite é para outra conta, saia e entre com ela.",
    );
    expect(portalOf(en).get("notices.inviteOtherAccount")).toBe(
      "Your account is already linked. If this invitation is for another account, sign out and sign in with that one.",
    );
  });

  test("the notice for a linked account that opens an invitation link does not tell the student to sign out as if the invitation were someone else's", () => {
    for (const [locale, messages] of [["es", es], ["pt", pt], ["en", en]] as const) {
      const text = portalOf(messages).get("notices.inviteOtherAccount") ?? "";
      // Empieza diciendo que la cuenta ya está vinculada; salir es solo si la invitación es de otra cuenta.
      expect(text, locale).toMatch(/^(Tu cuenta ya está|A sua conta já está|Your account is already) /);
      expect(text, locale).toMatch(/(Si|Se|If) /);
    }
  });

  test("the empty state of a purchase says what happens", () => {
    expect(portalOf(es).get("deliveries.empty")).toBe("Tallami todavía no subió entregas para esta compra.");
  });

  test("Spanish uses voseo: the second person is `vos`, never `tú`", () => {
    for (const [path, message] of portalOf(es)) {
      expect(message, path).not.toMatch(/\b(tienes|puedes|quieres|eres|haz|ingresa|entra|pide|escribe)\b/i);
    }
  });

  test("English is not Spanish copied: every message differs, but the proper names", () => {
    const spanish = portalOf(es);
    const copied = [...portalOf(en)].filter(([path, message]) => !SAME_IN_EVERY_LANGUAGE.has(path) && message === spanish.get(path));

    expect(copied.map(([path]) => path)).toEqual([]);
  });

  test("Portuguese is not Spanish copied: every message differs, but the proper names and the words that are the same", () => {
    const spanish = portalOf(es);
    const copied = [...portalOf(pt)].filter(
      ([path, message]) => !SAME_IN_EVERY_LANGUAGE.has(path) && !SAME_IN_PORTUGUESE.has(path) && message === spanish.get(path),
    );

    expect(copied.map(([path]) => path)).toEqual([]);
  });
});
