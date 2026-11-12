import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { markStudentReadAction, sendStudentMessageAction } from "@/app/[locale]/portal/mensajes/actions";
import { listMessages } from "@/chat/conversations";
import { notifyChatMessage } from "@/chat/emails";
import { CHAT_IDLE, type ChatFormState } from "@/chat/form-state";
import { STUDENT_MESSAGES_PER_HOUR } from "@/chat/policy";
import { getDb, type Db } from "@/db/client";
import { conversations, messages } from "@/db/schema";
import type { PortalAccount } from "@/portal/accounts";
import { getCurrentStudent } from "@/portal/current";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer } from "../helpers/portal";

// Las acciones del alumno en su página de mensajes: la cuenta sale de la sesión y el alumno de esa cuenta;
// del formulario solo llega el texto. Corren contra una base PGlite de verdad; la sesión, `after`,
// `revalidatePath` y el email se reemplazan.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/portal/current", () => ({ getCurrentStudent: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/chat/emails", () => ({ notifyChatMessage: vi.fn(async () => undefined) }));

const currentStudent = vi.mocked(getCurrentStudent);
const scheduled = vi.mocked(after);

let db: Db;
let customerId: string;
let account: PortalAccount;

function accountFor(id: string, linkedTo: string | null): PortalAccount {
  return { id, provider: "discord", displayName: "Ana", email: "ana@example.com", customerId: linkedTo, handle: null, locale: "es" };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function send(fields: Record<string, string>, previous: ChatFormState = CHAT_IDLE): Promise<ChatFormState> {
  return sendStudentMessageAction(previous, form(fields));
}

beforeEach(async () => {
  db = await createTestDb();
  customerId = await insertTestCustomer(db, "Ana");
  account = accountFor(await insertTestAccount(db, { customerId }), customerId);
  vi.mocked(getDb).mockReset();
  vi.mocked(getDb).mockResolvedValue(db);
  currentStudent.mockReset();
  currentStudent.mockResolvedValue(account);
  scheduled.mockClear();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(notifyChatMessage).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendStudentMessageAction", () => {
  test("with the session of a linked account, saves the message and comes back sent with an empty box", async () => {
    const state = await send({ body: "hola, Tallami" });

    expect(state).toEqual({ outcome: "sent", body: "" });
    expect((await listMessages(db, customerId)).map(({ sender, body }) => ({ sender, body }))).toEqual([
      { sender: "student", body: "hola, Tallami" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/[locale]/portal/mensajes", "page");
  });

  test("without a session: signed-out, with the text back, and no row", async () => {
    currentStudent.mockResolvedValue(null);

    expect(await send({ body: "hola" })).toEqual({ outcome: "signed-out", body: "hola" });
    expect(await db.select().from(messages)).toEqual([]);
    expect(await db.select().from(conversations)).toEqual([]);
    expect(scheduled).not.toHaveBeenCalled();
  });

  test("an account that is not linked answers the same, and writes nothing", async () => {
    currentStudent.mockResolvedValue(accountFor(account.id, null));

    expect(await send({ body: "hola" })).toEqual({ outcome: "signed-out", body: "hola" });
    expect(await db.select().from(messages)).toEqual([]);
  });

  test.each(["", "   \n  "])("an empty text %j is invalid, with the text back", async (body) => {
    expect(await send({ body })).toEqual({ outcome: "invalid", body });
    expect(await db.select().from(messages)).toEqual([]);
  });

  test("2,001 characters are invalid, with the text back", async () => {
    const body = "a".repeat(2001);

    expect(await send({ body })).toEqual({ outcome: "invalid", body });
  });

  test("a form without the field is invalid", async () => {
    expect(await send({})).toEqual({ outcome: "invalid", body: "" });
  });

  test("past the limit of the hour: rate-limited, with the text back", async () => {
    for (let index = 0; index < STUDENT_MESSAGES_PER_HOUR; index += 1) {
      expect((await send({ body: `mensaje ${index}` })).outcome).toBe("sent");
    }

    expect(await send({ body: "uno más" })).toEqual({ outcome: "rate-limited", body: "uno más" });
    expect(await db.select().from(messages)).toHaveLength(STUDENT_MESSAGES_PER_HOUR);
  });

  test("the same text sent twice in a row (a double click) is shown as sent and saved once, with no second email", async () => {
    await send({ body: "doble" });
    scheduled.mockClear();

    expect(await send({ body: "doble" })).toEqual({ outcome: "sent", body: "" });
    expect(await db.select().from(messages)).toHaveLength(1);
    expect(scheduled).not.toHaveBeenCalled();
  });

  test("when the database throws: failed, with the text back, never thrown, and the log has only the type of the error", async () => {
    vi.mocked(getDb).mockRejectedValue(new TypeError("conexión a postgres://usuario:clave@db falló con el texto hola secreto"));

    expect(await send({ body: "hola secreto" })).toEqual({ outcome: "failed", body: "hola secreto" });
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toMatch(/hola secreto|postgres:\/\/|clave/);
  });

  test("when reading the session throws: failed too", async () => {
    currentStudent.mockRejectedValue(new Error("la base no contestó"));

    expect(await send({ body: "hola" })).toEqual({ outcome: "failed", body: "hola" });
  });

  test("lets the control-flow errors of Next through", async () => {
    currentStudent.mockImplementation(async () => notFound());

    await expect(send({ body: "hola" })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  test("a customerId or conversationId in the form is ignored: the message goes to the conversation of the account", async () => {
    const otherCustomer = await insertTestCustomer(db, "Beto");
    await insertTestAccount(db, { customerId: otherCustomer });

    await send({ body: "para Ana", customerId: otherCustomer, conversationId: otherCustomer });

    expect(await listMessages(db, otherCustomer)).toEqual([]);
    expect((await listMessages(db, customerId)).map(({ body }) => body)).toEqual(["para Ana"]);
  });

  test("the email to Tallami is scheduled with `after` only when the send says to notify", async () => {
    await send({ body: "primero" });

    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(notifyChatMessage).not.toHaveBeenCalled(); // todavía no: corre después de responder
    await (scheduled.mock.calls[0][0] as () => Promise<void>)();
    expect(notifyChatMessage).toHaveBeenCalledWith(db, customerId, "student");

    // Tallami todavía no leyó el primero: el segundo no avisa otra vez.
    scheduled.mockClear();
    expect((await send({ body: "segundo" })).outcome).toBe("sent");
    expect(scheduled).not.toHaveBeenCalled();
  });

  test("nothing is scheduled when the send does not go through", async () => {
    await send({ body: "" });
    currentStudent.mockResolvedValue(null);
    await send({ body: "hola" });

    expect(scheduled).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("markStudentReadAction", () => {
  async function studentReadAt(): Promise<Date | null> {
    const [row] = await db.select().from(conversations);
    return row?.studentReadAt ?? null;
  }

  test("marks the conversation of the account as read by the student", async () => {
    await db.insert(conversations).values({ customerId, lastMessageAt: new Date("2026-11-01T00:00:00Z") });

    await markStudentReadAction();

    expect(await studentReadAt()).toBeInstanceOf(Date);
  });

  test("without a session it does nothing", async () => {
    await db.insert(conversations).values({ customerId, lastMessageAt: new Date("2026-11-01T00:00:00Z") });
    currentStudent.mockResolvedValue(null);

    await markStudentReadAction();

    expect(await studentReadAt()).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  test("an account that is not linked does nothing", async () => {
    await db.insert(conversations).values({ customerId, lastMessageAt: new Date("2026-11-01T00:00:00Z") });
    currentStudent.mockResolvedValue(accountFor(account.id, null));

    await markStudentReadAction();

    expect(await studentReadAt()).toBeNull();
  });

  test("never throws when the database fails, and logs only the type of the error", async () => {
    vi.mocked(getDb).mockRejectedValue(new RangeError("postgres://x"));

    await expect(markStudentReadAction()).resolves.toBeUndefined();
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain("postgres://");
  });
});
