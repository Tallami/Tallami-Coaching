import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { LOGIN_BLOCKED_ALERT_KEY, notifyIfJustBlocked } from "@/admin/alerts/blocked";
import { notifySecurityEvent } from "@/admin/alerts/notify";
import { claimAlertSlot } from "@/admin/alerts/throttle";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "@/admin/auth/rate-limit";
import type { Db } from "@/db/client";
import { loginAttempts, settings } from "@/db/schema";
import { createTestDb } from "../helpers/db";

// El aviso de bloqueo sale como mucho una vez por ventana de intentos (15 minutos) en
// total, sin importar cuántas conexiones se bloqueen: el tope por conexión solo decide
// CUÁNDO una conexión llegó al límite; qué tan seguido se avisa lo decide `claimAlertSlot`,
// con una sola escritura condicional en la base.

vi.mock("@/admin/alerts/notify", () => ({ notifySecurityEvent: vi.fn() }));

const START = new Date("2026-10-21T10:00:00.000Z");
const MINUTE_MS = 60 * 1000;
const KEY = "alerta:prueba";

function after(ms: number): Date {
  return new Date(START.getTime() + ms);
}

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.mocked(notifySecurityEvent).mockClear();
  await db.delete(loginAttempts);
  await db.delete(settings);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Anota `count` intentos fallidos de `ipHash` a la hora `at`, directo en la tabla. */
async function seedFailures(ipHash: string, count: number, at: Date): Promise<void> {
  await db.insert(loginAttempts).values(Array.from({ length: count }, () => ({ ipHash, succeeded: false, createdAt: at })));
}

describe("claimAlertSlot", () => {
  test("the first one gets the slot and the next ones, inside the window, do not", async () => {
    expect(await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, START)).toBe(true);
    expect(await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, START)).toBe(false);
    expect(await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, after(14 * MINUTE_MS + 59_000))).toBe(false);
  });

  test("once the whole window has passed, the slot is free again, and the window counts from the last claim", async () => {
    await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, START);

    expect(await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, after(LOGIN_WINDOW_MS))).toBe(true);
    expect(await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, after(LOGIN_WINDOW_MS + 14 * MINUTE_MS))).toBe(false);
    expect(await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, after(2 * LOGIN_WINDOW_MS))).toBe(true);
  });

  test("a burst of claims at the same moment lets exactly one through", async () => {
    const claims = await Promise.all(Array.from({ length: 12 }, () => claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, START)));

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  test("a burst right when the window ends also lets exactly one through", async () => {
    await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, START);

    const claims = await Promise.all(
      Array.from({ length: 12 }, () => claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, after(LOGIN_WINDOW_MS))),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  test("each key has its own slot", async () => {
    expect(await claimAlertSlot(db, "una", LOGIN_WINDOW_MS, START)).toBe(true);
    expect(await claimAlertSlot(db, "otra", LOGIN_WINDOW_MS, START)).toBe(true);
    expect(await claimAlertSlot(db, "una", LOGIN_WINDOW_MS, START)).toBe(false);
  });

  test("it only keeps the time of the claim, in one row of the settings table", async () => {
    await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, START);
    await claimAlertSlot(db, KEY, LOGIN_WINDOW_MS, after(LOGIN_WINDOW_MS));

    const rows = await db.select().from(settings).where(eq(settings.key, KEY));
    expect(rows).toHaveLength(1);
    expect(rows[0].updatedAt).toEqual(after(LOGIN_WINDOW_MS));
    expect(rows[0].value).toEqual({});
  });
});

describe("notifyIfJustBlocked", () => {
  test("five sequential failures notify one block, at the fifth", async () => {
    for (let failures = 1; failures < LOGIN_MAX_FAILURES; failures += 1) {
      await seedFailures("conexion-a", 1, START);
      await notifyIfJustBlocked(db, "conexion-a", START);
    }
    expect(notifySecurityEvent).not.toHaveBeenCalled();

    await seedFailures("conexion-a", 1, START);
    await notifyIfJustBlocked(db, "conexion-a", START);

    expect(vi.mocked(notifySecurityEvent).mock.calls).toEqual([["login-blocked"]]);
  });

  test("the same connection reaching the count again inside the window does not notify twice", async () => {
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES, START);

    await notifyIfJustBlocked(db, "conexion-a", START);
    await notifyIfJustBlocked(db, "conexion-a", START);
    await notifyIfJustBlocked(db, "conexion-a", after(5 * MINUTE_MS));

    expect(notifySecurityEvent).toHaveBeenCalledOnce();
  });

  test("a parallel burst that reaches the limit notifies exactly one block", async () => {
    // Todos los pedidos de la ráfaga cuentan exactamente 5 fallos: sin el tope global serían 5 avisos.
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES, START);

    await Promise.all(Array.from({ length: 8 }, () => notifyIfJustBlocked(db, "conexion-a", START)));

    expect(notifySecurityEvent).toHaveBeenCalledOnce();
  });

  test("a burst where every request counts above the limit still notifies exactly one block", async () => {
    // Las filas de los intentos rechazados todavía no se borraron cuando los demás cuentan: todos ven más de 5.
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES + 3, START);

    await Promise.all(Array.from({ length: 8 }, () => notifyIfJustBlocked(db, "conexion-a", START)));

    expect(vi.mocked(notifySecurityEvent).mock.calls).toEqual([["login-blocked"]]);
  });

  test("failures five, six and seven in a row notify one block, not three", async () => {
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES - 1, START);

    for (let failures = LOGIN_MAX_FAILURES; failures <= LOGIN_MAX_FAILURES + 2; failures += 1) {
      await seedFailures("conexion-a", 1, START);
      await notifyIfJustBlocked(db, "conexion-a", START);
    }

    expect(vi.mocked(notifySecurityEvent).mock.calls).toEqual([["login-blocked"]]);
  });

  test("another connection blocked inside the same window adds no second notice", async () => {
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES, START);
    await seedFailures("conexion-b", LOGIN_MAX_FAILURES, after(MINUTE_MS));

    await notifyIfJustBlocked(db, "conexion-a", START);
    await notifyIfJustBlocked(db, "conexion-b", after(MINUTE_MS));
    await notifyIfJustBlocked(db, "conexion-b", after(14 * MINUTE_MS));

    expect(notifySecurityEvent).toHaveBeenCalledOnce();
  });

  test("after the window, a new block notifies again", async () => {
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES, START);
    await notifyIfJustBlocked(db, "conexion-a", START);
    await seedFailures("conexion-b", LOGIN_MAX_FAILURES, after(LOGIN_WINDOW_MS));

    await notifyIfJustBlocked(db, "conexion-b", after(LOGIN_WINDOW_MS));

    expect(vi.mocked(notifySecurityEvent).mock.calls).toEqual([["login-blocked"], ["login-blocked"]]);
  });

  test("a connection that has not reached the limit does not use up the slot", async () => {
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES - 1, START);
    await notifyIfJustBlocked(db, "conexion-a", START);
    expect(notifySecurityEvent).not.toHaveBeenCalled();

    await seedFailures("conexion-b", LOGIN_MAX_FAILURES, START);
    await notifyIfJustBlocked(db, "conexion-b", START);

    expect(notifySecurityEvent).toHaveBeenCalledOnce();
  });

  test("it uses the key of the login-blocked slot in the settings table", async () => {
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES, START);

    await notifyIfJustBlocked(db, "conexion-a", START);

    const keys = (await db.select({ key: settings.key }).from(settings)).map((row) => row.key);
    expect(keys).toEqual([LOGIN_BLOCKED_ALERT_KEY]);
  });

  test("an error counting the failures is swallowed and logged by its name only", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenDb = {
      select: () => {
        throw new TypeError("contraseña=hunter2 en postgres://usuario:clave@host/db");
      },
    } as unknown as Db;

    await expect(notifyIfJustBlocked(brokenDb, "conexion-a", START)).resolves.toBeUndefined();

    expect(notifySecurityEvent).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledOnce();
    const output = JSON.stringify(logged.mock.calls);
    expect(output).toContain("TypeError");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("postgres://");
  });

  test("an error in the slot store is swallowed too, logged by its name only, and nothing is notified", async () => {
    await seedFailures("conexion-a", LOGIN_MAX_FAILURES, START);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("falló la escritura de postgres://usuario:clave@host/db");
    });

    await expect(notifyIfJustBlocked(db, "conexion-a", START)).resolves.toBeUndefined();

    expect(notifySecurityEvent).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledOnce();
    const output = JSON.stringify(logged.mock.calls);
    expect(output).toContain("Error");
    expect(output).not.toContain("postgres://");
    expect(output).not.toContain("escritura");
  });
});
