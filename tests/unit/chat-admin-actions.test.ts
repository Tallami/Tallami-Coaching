import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { requireAdmin } from "@/admin/auth/require-admin";
import { unreadConversationsForMenu } from "@/admin/chat/unread-count";
import {
  deleteConversationAction,
  markCoachReadAction,
  sendCoachMessageAction,
} from "@/app/admin/mensajes/actions";
import { listMessages, sendStudentMessage } from "@/chat/conversations";
import { notifyChatMessage } from "@/chat/emails";
import { CHAT_IDLE, type ChatFormState } from "@/chat/form-state";
import { getDb, type Db } from "@/db/client";
import { conversations, messages } from "@/db/schema";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer } from "../helpers/portal";

// Las acciones de Tallami en la sección Mensajes del panel y el número del menú. Corren contra una base
// PGlite de verdad; la sesión del panel, `after`, `revalidatePath` y el email se reemplazan.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/admin/auth/require-admin", () => ({ requireAdmin: vi.fn(async () => undefined) }));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/chat/emails", () => ({ notifyChatMessage: vi.fn(async () => undefined) }));

const scheduled = vi.mocked(after);
const NO_SESSION = new Error("sin sesión del panel");

let db: Db;
let linked: string;
let withoutAccount: string;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function send(customerId: string, body: string, previous: ChatFormState = CHAT_IDLE): Promise<ChatFormState> {
  return sendCoachMessageAction(customerId, previous, form({ body }));
}

beforeEach(async () => {
  db = await createTestDb();
  linked = await insertTestCustomer(db, "Ana");
  await insertTestAccount(db, { customerId: linked });
  withoutAccount = await insertTestCustomer(db, "Sin cuenta");
  vi.mocked(getDb).mockReset();
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
  scheduled.mockClear();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(notifyChatMessage).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendCoachMessageAction", () => {
  test("saves the message for a student with an account and comes back sent with an empty box", async () => {
    expect(await send(linked, "hola, Ana")).toEqual({ outcome: "sent", body: "" });

    expect((await listMessages(db, linked)).map(({ sender, body }) => ({ sender, body }))).toEqual([
      { sender: "coach", body: "hola, Ana" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/mensajes/[customerId]", "page");
  });

  test("a student without a linked account: no-account, with the text back, and no row at all", async () => {
    expect(await send(withoutAccount, "¿me ves?")).toEqual({ outcome: "no-account", body: "¿me ves?" });

    expect(await db.select().from(messages)).toEqual([]);
    expect(await db.select().from(conversations)).toEqual([]);
    expect(scheduled).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("a student that lost the account while Tallami was writing is refused the same way, with what he wrote", async () => {
    await sendStudentMessage(db, withoutAccount, "antes de perder la cuenta");
    const before = await db.select().from(messages);

    expect(await send(withoutAccount, "ya no hay cuenta")).toEqual({ outcome: "no-account", body: "ya no hay cuenta" });
    expect(await db.select().from(messages)).toEqual(before);
  });

  test.each(["no es un uuid", "", "00000000-0000-0000-0000-000000000000"])("the id %j does not exist: no-account, nothing saved", async (id) => {
    expect(await send(id, "hola")).toEqual({ outcome: "no-account", body: "hola" });
    expect(await db.select().from(messages)).toEqual([]);
  });

  test.each(["", "   \n  "])("an empty text %j is invalid, with the text back", async (body) => {
    expect(await send(linked, body)).toEqual({ outcome: "invalid", body });
    expect(await db.select().from(messages)).toEqual([]);
  });

  test("2,001 characters are invalid", async () => {
    const body = "a".repeat(2001);

    expect(await send(linked, body)).toEqual({ outcome: "invalid", body });
  });

  test("the same text twice in a row is shown as sent, saved once, and sends no second email", async () => {
    await send(linked, "doble");
    scheduled.mockClear();

    expect(await send(linked, "doble")).toEqual({ outcome: "sent", body: "" });
    expect(await db.select().from(messages)).toHaveLength(1);
    expect(scheduled).not.toHaveBeenCalled();
  });

  test("the email to the student is scheduled with `after` only when the send says to notify", async () => {
    await send(linked, "primero");

    expect(scheduled).toHaveBeenCalledTimes(1);
    expect(notifyChatMessage).not.toHaveBeenCalled(); // corre después de responder
    await (scheduled.mock.calls[0][0] as () => Promise<void>)();
    expect(notifyChatMessage).toHaveBeenCalledWith(db, linked, "coach");

    // El alumno todavía no leyó el primero: el segundo no avisa otra vez.
    scheduled.mockClear();
    expect((await send(linked, "segundo")).outcome).toBe("sent");
    expect(scheduled).not.toHaveBeenCalled();
  });

  test("when the database throws: failed, with the text back, never thrown, and the log has only the type of the error", async () => {
    vi.mocked(getDb).mockRejectedValue(new TypeError("conexión a postgres://usuario:clave@db con el texto hola secreto"));

    expect(await send(linked, "hola secreto")).toEqual({ outcome: "failed", body: "hola secreto" });
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toMatch(/hola secreto|postgres:\/\/|clave/);
  });

  test("a form without the field is invalid", async () => {
    expect(await sendCoachMessageAction(linked, CHAT_IDLE, form({}))).toEqual({ outcome: "invalid", body: "" });
  });

  test("without the panel session it saves nothing: the check comes first and its redirect goes through", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(NO_SESSION);

    await expect(send(linked, "hola")).rejects.toBe(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
    expect(await db.select().from(messages)).toEqual([]);
  });
});

describe("markCoachReadAction", () => {
  async function coachReadAt(): Promise<Date | null> {
    const [row] = await db.select().from(conversations);
    return row?.coachReadAt ?? null;
  }

  test("marks the conversation of that student as read by Tallami", async () => {
    await sendStudentMessage(db, linked, "hola");

    await markCoachReadAction(linked);

    expect(await coachReadAt()).toBeInstanceOf(Date);
  });

  test("an id that is not a UUID does nothing and does not throw", async () => {
    await sendStudentMessage(db, linked, "hola");
    const before = await coachReadAt();

    await expect(markCoachReadAction("no es un uuid")).resolves.toBeUndefined();
    expect(await coachReadAt()).toEqual(before);
  });

  test("never throws when the database fails, and logs only the type of the error", async () => {
    vi.mocked(getDb).mockRejectedValue(new RangeError("postgres://x"));

    await expect(markCoachReadAction(linked)).resolves.toBeUndefined();
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain("postgres://");
  });

  test("without the panel session it does nothing", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(NO_SESSION);

    await expect(markCoachReadAction(linked)).rejects.toBe(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("deleteConversationAction", () => {
  test("deletes the conversation with its messages, keeps the student, and goes back to the inbox with a notice", async () => {
    await sendStudentMessage(db, linked, "hola");

    await expect(deleteConversationAction(linked)).rejects.toMatchObject({
      digest: expect.stringContaining("/admin/mensajes?borrada=1"),
    });

    expect(await db.select().from(messages)).toEqual([]);
    expect(await db.select().from(conversations)).toEqual([]);
  });

  test("an id that is not a UUID deletes nothing", async () => {
    await sendStudentMessage(db, linked, "hola");

    await expect(deleteConversationAction("no es un uuid")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  test("without the panel session it deletes nothing", async () => {
    await sendStudentMessage(db, linked, "hola");
    vi.mocked(requireAdmin).mockRejectedValue(NO_SESSION);

    await expect(deleteConversationAction(linked)).rejects.toBe(NO_SESSION);
    expect(await db.select().from(messages)).toHaveLength(1);
  });
});

describe("unreadConversationsForMenu", () => {
  test("counts the conversations with something unread, not the messages", async () => {
    const other = await insertTestCustomer(db, "Beto");
    await sendStudentMessage(db, linked, "uno");
    await sendStudentMessage(db, linked, "dos");
    await sendStudentMessage(db, other, "tres");

    expect(await unreadConversationsForMenu()).toBe(2);
  });

  test("checks the panel session first: without it, it reads nothing", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(NO_SESSION);

    await expect(unreadConversationsForMenu()).rejects.toBe(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("when the database fails it answers 0 and logs only the type of the error", async () => {
    vi.mocked(getDb).mockRejectedValue(new TypeError("postgres://usuario:clave@db"));

    expect(await unreadConversationsForMenu()).toBe(0);
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toMatch(/postgres:\/\/|clave/);
  });
});
