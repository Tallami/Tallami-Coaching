import { describe, expect, test } from "vitest";
import { INVITE_OUTCOMES } from "@/portal/invites";
import { NOTICE_KEYS, parsePortalQuery, portalNotice, type PortalQuery, type PortalView } from "@/portal/page-state";

// La página del portal lee dos cosas de la dirección: lo que le cuenta el ingreso (`?ingreso=fallido`,
// `?invitacion=vinculada|invalida|ocupada`) y el token de una invitación (`?invitacion=<token>`, el
// link que Tallami le manda al alumno). La dirección la escribe cualquiera: solo se reconoce lo
// exacto, y lo que se muestra depende además de la sesión (un `?invitacion=vinculada` escrito a mano
// no hace aparecer un "tu cuenta quedó vinculada" que no es cierto).

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const NONE: PortalQuery = { inviteToken: null, inviteOutcome: null, signInFailed: false };

describe("parsePortalQuery", () => {
  test("an address without parameters says nothing", () => {
    expect(parsePortalQuery({})).toEqual(NONE);
  });

  test("a token of 32 bytes in base64url is the invitation of the link", () => {
    expect(TOKEN).toHaveLength(43);
    expect(parsePortalQuery({ invitacion: TOKEN })).toEqual({ ...NONE, inviteToken: TOKEN });
  });

  test.each(INVITE_OUTCOMES)("%s is what the sign-in tells about the invitation", (outcome) => {
    expect(parsePortalQuery({ invitacion: outcome })).toEqual({ ...NONE, inviteOutcome: outcome });
  });

  test.each([
    ["a token that is one character short", TOKEN.slice(1)],
    ["a token that is one character long", `${TOKEN}A`],
    ["a token with a character outside base64url", `${TOKEN.slice(0, 42)}+`],
    ["markup", "<script>alert(1)</script>"],
    ["an outcome that does not exist", "hackeada"],
    ["an outcome in capitals", "VINCULADA"],
    ["an empty value", ""],
  ])("ignores %s", (_label, value) => {
    expect(parsePortalQuery({ invitacion: value })).toEqual(NONE);
  });

  test("a repeated parameter counts by its first value", () => {
    expect(parsePortalQuery({ invitacion: [TOKEN, "invalida"] })).toEqual({ ...NONE, inviteToken: TOKEN });
    expect(parsePortalQuery({ invitacion: ["ocupada", TOKEN] })).toEqual({ ...NONE, inviteOutcome: "ocupada" });
  });

  test("only `fallido` means the sign-in failed", () => {
    expect(parsePortalQuery({ ingreso: "fallido" })).toEqual({ ...NONE, signInFailed: true });
    expect(parsePortalQuery({ ingreso: "ok" })).toEqual(NONE);
    expect(parsePortalQuery({ ingreso: "" })).toEqual(NONE);
  });

  test("both can come together", () => {
    expect(parsePortalQuery({ ingreso: "fallido", invitacion: TOKEN })).toEqual({
      inviteToken: TOKEN,
      inviteOutcome: null,
      signInFailed: true,
    });
  });
});

describe("portalNotice", () => {
  const notice = (query: Partial<PortalQuery>, view: PortalView) => portalNotice({ ...NONE, ...query }, view);

  test("says nothing when nothing happened", () => {
    expect(notice({}, "signedOut")).toBeNull();
    expect(notice({}, "unlinked")).toBeNull();
    expect(notice({}, "linked")).toBeNull();
  });

  test("a failed sign-in is an error whatever the view", () => {
    for (const view of ["signedOut", "unlinked", "linked"] as const) {
      expect(notice({ signInFailed: true }, view)).toEqual({ key: "signInFailed", tone: "error" });
    }
  });

  test("a failed sign-in comes before anything else", () => {
    expect(notice({ signInFailed: true, inviteToken: TOKEN }, "signedOut")?.key).toBe("signInFailed");
    expect(notice({ signInFailed: true, inviteOutcome: "vinculada" }, "linked")?.key).toBe("signInFailed");
  });

  test("a student that arrives with the link of an invitation, without a session, is asked to sign in to link the account", () => {
    expect(notice({ inviteToken: TOKEN }, "signedOut")).toEqual({ key: "inviteToSignIn", tone: "info" });
  });

  test("a linked account that opens the link of an invitation is told it is signed in with another account", () => {
    expect(notice({ inviteToken: TOKEN }, "linked")).toEqual({ key: "inviteOtherAccount", tone: "info" });
  });

  test("the token of a link says nothing to a linked account when the sign-in already answered about an invitation", () => {
    // Una dirección trae una sola cosa en `invitacion`: un token o una respuesta del ingreso, nunca las dos.
    expect(notice({ inviteOutcome: "vinculada" }, "linked")?.key).toBe("linked");
    expect(notice({ inviteOutcome: "invalida" }, "linked")?.key).toBe("alreadyLinked");
  });

  test("a failed sign-in still comes before the notice about the other account", () => {
    expect(notice({ signInFailed: true, inviteToken: TOKEN }, "linked")?.key).toBe("signInFailed");
  });

  test("an account without a link that opens the link of an invitation is answered by the view itself, not by a notice", () => {
    expect(notice({ inviteToken: TOKEN }, "unlinked")).toBeNull();
  });

  test("a linked account that just used its invitation is told, as good news", () => {
    expect(notice({ inviteOutcome: "vinculada" }, "linked")).toEqual({ key: "linked", tone: "success" });
  });

  test("`vinculada` typed by hand in front of an account that is not linked is not believed", () => {
    expect(notice({ inviteOutcome: "vinculada" }, "unlinked")).toBeNull();
    expect(notice({ inviteOutcome: "vinculada" }, "signedOut")).toBeNull();
  });

  test("an invalid invitation is an error for an account that is not linked", () => {
    expect(notice({ inviteOutcome: "invalida" }, "unlinked")).toEqual({ key: "inviteInvalid", tone: "error" });
  });

  test("an invalid invitation, seen by an account that is already linked, is neutral: it is a retry, not a problem", () => {
    expect(notice({ inviteOutcome: "invalida" }, "linked")).toEqual({ key: "alreadyLinked", tone: "info" });
  });

  test("a taken invitation is an error for linked and unlinked accounts alike", () => {
    expect(notice({ inviteOutcome: "ocupada" }, "unlinked")).toEqual({ key: "inviteTaken", tone: "error" });
    expect(notice({ inviteOutcome: "ocupada" }, "linked")).toEqual({ key: "inviteTaken", tone: "error" });
  });

  test("without a session, the outcomes of an invitation are not shown: there is no account they could be about", () => {
    expect(notice({ inviteOutcome: "invalida" }, "signedOut")).toBeNull();
    expect(notice({ inviteOutcome: "ocupada" }, "signedOut")).toBeNull();
  });

  test("every notice the page can show has a key in the catalog list", () => {
    const keys = [
      notice({ signInFailed: true }, "signedOut"),
      notice({ inviteToken: TOKEN }, "signedOut"),
      notice({ inviteToken: TOKEN }, "linked"),
      notice({ inviteOutcome: "vinculada" }, "linked"),
      notice({ inviteOutcome: "invalida" }, "linked"),
      notice({ inviteOutcome: "invalida" }, "unlinked"),
      notice({ inviteOutcome: "ocupada" }, "unlinked"),
    ].map((found) => found?.key);

    for (const key of keys) expect(NOTICE_KEYS).toContain(key);
    expect(new Set(keys).size).toBe(NOTICE_KEYS.length);
  });
});
