import { startAuthentication } from "@simplewebauthn/browser";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { beginReauthAction, finishReauthAction } from "@/app/admin/configuracion/seguridad/actions";
import { ReauthError, withReauth } from "@/admin/security/with-reauth";

// `withReauth` es el lado del navegador de la confirmación reciente: si una acción
// delicada contesta "confirmá con tu llave", hace la ceremonia y la repite una sola
// vez. Las acciones del servidor y el navegador son dobles: lo que se prueba es el
// orden, los reintentos y qué se le dice a Tallami cuando algo no sale.

vi.mock("@/app/admin/configuracion/seguridad/actions", () => ({
  beginReauthAction: vi.fn(),
  finishReauthAction: vi.fn(),
}));
vi.mock("@simplewebauthn/browser", () => ({ startAuthentication: vi.fn() }));

const ORIGIN = "https://panel.tallami.example";
const REAUTH_REQUIRED = { ok: false, error: "reauth-required" } as const;
const OPTIONS = { challenge: "desafio", rpId: "tallami.example" };
const ANSWER = { id: "credencial", type: "public-key" };

function browserError(name: string): Error {
  return Object.assign(new Error("mensaje en inglés del navegador"), { name });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(beginReauthAction).mockResolvedValue({ ok: true, options: OPTIONS });
  vi.mocked(startAuthentication).mockResolvedValue(ANSWER as never);
  vi.mocked(finishReauthAction).mockResolvedValue({ ok: true });
});

describe("withReauth", () => {
  test("hands back what the action answered, without asking for the key, when no confirmation is needed", async () => {
    const run = vi.fn(async () => ({ ok: true as const, id: 7 }));

    expect(await withReauth(run, ORIGIN)).toEqual({ ok: true, id: 7 });

    expect(run).toHaveBeenCalledOnce();
    expect(beginReauthAction).not.toHaveBeenCalled();
    expect(startAuthentication).not.toHaveBeenCalled();
  });

  test("hands back an ordinary failure untouched, without asking for the key", async () => {
    const run = vi.fn(async () => ({ ok: false as const, error: "last" as const }));

    expect(await withReauth(run, ORIGIN)).toEqual({ ok: false, error: "last" });

    expect(beginReauthAction).not.toHaveBeenCalled();
  });

  test("when the action asks to confirm, asks the browser for the key, sends the answer and tries the action again", async () => {
    const run = vi
      .fn<() => Promise<{ ok: true } | typeof REAUTH_REQUIRED>>()
      .mockResolvedValueOnce(REAUTH_REQUIRED)
      .mockResolvedValueOnce({ ok: true });

    expect(await withReauth(run, ORIGIN)).toEqual({ ok: true });

    expect(startAuthentication).toHaveBeenCalledExactlyOnceWith({ optionsJSON: OPTIONS });
    expect(finishReauthAction).toHaveBeenCalledExactlyOnceWith(ANSWER);
    expect(run).toHaveBeenCalledTimes(2);
    const order = [
      vi.mocked(run).mock.invocationCallOrder[0],
      vi.mocked(beginReauthAction).mock.invocationCallOrder[0],
      vi.mocked(startAuthentication).mock.invocationCallOrder[0],
      vi.mocked(finishReauthAction).mock.invocationCallOrder[0],
      vi.mocked(run).mock.invocationCallOrder[1],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("tries only once more: if the action still asks to confirm, it gives up", async () => {
    const run = vi.fn(async () => REAUTH_REQUIRED);

    await expect(withReauth(run, ORIGIN)).rejects.toBeInstanceOf(ReauthError);

    expect(run).toHaveBeenCalledTimes(2);
    expect(beginReauthAction).toHaveBeenCalledOnce();
  });

  test("a cancelled browser prompt is explained and never reaches the server, so it counts as nothing", async () => {
    vi.mocked(startAuthentication).mockRejectedValue(browserError("NotAllowedError"));
    const run = vi.fn(async () => REAUTH_REQUIRED);

    const error = await withReauth(run, ORIGIN).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ReauthError);
    expect((error as ReauthError).message).toContain("Cancelaste");
    expect(finishReauthAction).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });

  test("on another address than the configured one, says where the keys work", async () => {
    vi.mocked(startAuthentication).mockRejectedValue(browserError("SecurityError"));

    const error = await withReauth(async () => REAUTH_REQUIRED, ORIGIN).catch((thrown: unknown) => thrown);

    expect((error as ReauthError).message).toBe(`Las llaves solo funcionan en ${ORIGIN}.`);
  });

  test.each([
    ["the server cannot ask for the key", () => vi.mocked(beginReauthAction).mockResolvedValue({ ok: false, error: "failed" }), "No pudimos confirmar"],
    ["the server does not accept the key", () => vi.mocked(finishReauthAction).mockResolvedValue({ ok: false, error: "failed" }), "No pudimos confirmar"],
    ["the confirmation expired on the way", () => vi.mocked(finishReauthAction).mockResolvedValue({ ok: false, error: "expired" }), "venció"],
    ["the server does not answer", () => vi.mocked(beginReauthAction).mockRejectedValue(new Error("sin red")), "unos minutos"],
  ])("when %s, it says so and does not try the action again", async (_label, arrange, expected) => {
    arrange();
    const run = vi.fn(async () => REAUTH_REQUIRED);

    const error = await withReauth(run, ORIGIN).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ReauthError);
    expect((error as ReauthError).message).toContain(expected);
    expect(run).toHaveBeenCalledOnce();
  });

  test("lets an error of the action itself go through as it is", async () => {
    const failure = new Error("la acción se cayó");

    await expect(withReauth(async () => Promise.reject(failure), ORIGIN)).rejects.toBe(failure);
  });
});
