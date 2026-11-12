import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  cleanMessageBody,
  countUnreadConversations,
  deleteConversation,
  listInbox,
  listMessages,
  markRead,
  purgeStaleConversations,
  sendCoachMessage,
  sendStudentMessage,
  unreadForStudent,
} from "@/chat/conversations";
import { MESSAGE_MAX_LENGTH } from "@/chat/policy";
import type { Db } from "@/db/client";
import { conversations, customers, messages, sales } from "@/db/schema";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer, insertTestSale } from "../helpers/portal";

const START = new Date("2026-11-12T12:00:00.000Z");
const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * 1000;
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

function after(ms: number): Date {
  return new Date(START.getTime() + ms);
}

let db: Db;
let customerId: string;

beforeEach(async () => {
  db = await createTestDb();
  customerId = await insertTestCustomer(db, "Ana");
  await insertTestAccount(db, { customerId });
});

async function conversationRows() {
  return db.select().from(conversations);
}

async function messageRows() {
  return db.select().from(messages);
}

describe("cleanMessageBody", () => {
  test("removes NUL, turns CRLF into LF and trims the ends", () => {
    expect(cleanMessageBody("  hola\r\nchau \u0000 ")).toBe("hola\nchau");
  });

  test.each(["", "   ", "\n\n", "\u0000"])("returns null for the empty text %j", (raw) => {
    expect(cleanMessageBody(raw)).toBeNull();
  });

  test("accepts 2000 characters and rejects 2001", () => {
    expect(cleanMessageBody("a".repeat(MESSAGE_MAX_LENGTH))).toHaveLength(MESSAGE_MAX_LENGTH);
    expect(cleanMessageBody("a".repeat(MESSAGE_MAX_LENGTH + 1))).toBeNull();
  });

  test("counts an emoji as one character, like Postgres does", () => {
    const emojis = "😀".repeat(MESSAGE_MAX_LENGTH);

    expect(cleanMessageBody(emojis)).toBe(emojis);
    expect(cleanMessageBody(`${emojis}😀`)).toBeNull();
  });
});

describe("sendStudentMessage", () => {
  test("the first message creates the conversation and asks for a notice", async () => {
    const result = await sendStudentMessage(db, customerId, "Hola Tallami", START);

    expect(result).toMatchObject({
      kind: "sent",
      notify: true,
      message: { sender: "student", body: "Hola Tallami", createdAt: START.toISOString() },
    });
    const [conversation] = await conversationRows();
    expect(conversation.customerId).toBe(customerId);
    expect(conversation.lastMessageAt).toEqual(START);
    expect(conversation.studentReadAt).toEqual(START);
    expect(conversation.coachReadAt).toBeNull();
  });

  test("a second message while the coach has not read does not ask for a notice; after he reads, it does", async () => {
    await sendStudentMessage(db, customerId, "uno", START);

    const second = await sendStudentMessage(db, customerId, "dos", after(SECOND_MS * 20));
    expect(second).toMatchObject({ kind: "sent", notify: false });

    await markRead(db, customerId, "coach", after(SECOND_MS * 30));
    const third = await sendStudentMessage(db, customerId, "tres", after(SECOND_MS * 40));
    expect(third).toMatchObject({ kind: "sent", notify: true });
  });

  test("unread messages of the coach do not change the notice of the student's messages", async () => {
    await sendCoachMessage(db, customerId, "primero yo", START);

    const first = await sendStudentMessage(db, customerId, "uno", after(SECOND_MS * 20));
    const second = await sendStudentMessage(db, customerId, "dos", after(SECOND_MS * 40));

    expect(first).toMatchObject({ kind: "sent", notify: true });
    expect(second).toMatchObject({ kind: "sent", notify: false });
  });

  test("an answer of the coach counts as read for him, so the next message of the student notifies again", async () => {
    await sendStudentMessage(db, customerId, "uno", START);
    await sendCoachMessage(db, customerId, "respuesta", after(SECOND_MS * 20));

    const next = await sendStudentMessage(db, customerId, "dos", after(SECOND_MS * 40));

    expect(next).toMatchObject({ kind: "sent", notify: true });
  });

  test("the same text from the same side within 9 seconds is a duplicate and is saved once", async () => {
    await sendStudentMessage(db, customerId, "Hola", START);

    const again = await sendStudentMessage(db, customerId, "Hola", after(SECOND_MS * 9));

    expect(again).toEqual({ kind: "duplicate" });
    expect(await messageRows()).toHaveLength(1);
  });

  test("the same text 11 seconds later, or from the other side, is saved", async () => {
    await sendStudentMessage(db, customerId, "Hola", START);

    expect(await sendStudentMessage(db, customerId, "Hola", after(SECOND_MS * 11))).toMatchObject({ kind: "sent" });
    expect(await sendCoachMessage(db, customerId, "Hola", after(SECOND_MS * 12))).toMatchObject({ kind: "sent" });
    expect(await messageRows()).toHaveLength(3);
  });

  test("a duplicate is judged on the cleaned text", async () => {
    await sendStudentMessage(db, customerId, "Hola\nque tal", START);

    const again = await sendStudentMessage(db, customerId, "  Hola\r\nque tal ", after(SECOND_MS));

    expect(again).toEqual({ kind: "duplicate" });
  });

  test("the 31st message within the hour is rate limited and leaves no row; an hour and a second after the first it passes", async () => {
    for (let index = 0; index < 30; index += 1) {
      const result = await sendStudentMessage(db, customerId, `mensaje ${index}`, after(SECOND_MS * index));
      expect(result.kind).toBe("sent");
    }

    expect(await sendStudentMessage(db, customerId, "uno más", after(SECOND_MS * 31))).toEqual({
      kind: "rate-limited",
    });
    expect(await messageRows()).toHaveLength(30);

    const later = await sendStudentMessage(db, customerId, "uno más", after(HOUR_MS + SECOND_MS));
    expect(later).toMatchObject({ kind: "sent" });
  });

  test("the messages of the coach do not count for the limit of the student", async () => {
    for (let index = 0; index < 5; index += 1) {
      await sendCoachMessage(db, customerId, `respuesta ${index}`, after(SECOND_MS * index));
    }

    expect(await sendStudentMessage(db, customerId, "hola", after(SECOND_MS * 10))).toMatchObject({ kind: "sent" });
  });

  test.each([["empty", ""], ["only spaces", "   "], ["too long", "a".repeat(MESSAGE_MAX_LENGTH + 1)]])(
    "%s text is invalid and creates no conversation",
    async (_name, body) => {
      expect(await sendStudentMessage(db, customerId, body, START)).toEqual({ kind: "invalid" });
      expect(await conversationRows()).toHaveLength(0);
      expect(await messageRows()).toHaveLength(0);
    },
  );

  test("a student that does not exist, or an id that is not a uuid, is invalid and leaves no row", async () => {
    expect(await sendStudentMessage(db, UNKNOWN_ID, "hola", START)).toEqual({ kind: "invalid" });
    expect(await sendStudentMessage(db, "no-es-uuid", "hola", START)).toEqual({ kind: "invalid" });
    expect(await conversationRows()).toHaveLength(0);
  });
});

describe("sendCoachMessage", () => {
  test("the first message creates the conversation and asks for a notice; the second does not until the student reads", async () => {
    const first = await sendCoachMessage(db, customerId, "Hola Ana", START);
    expect(first).toMatchObject({ kind: "sent", notify: true, message: { sender: "coach" } });
    const [conversation] = await conversationRows();
    expect(conversation.coachReadAt).toEqual(START);
    expect(conversation.studentReadAt).toBeNull();

    expect(await sendCoachMessage(db, customerId, "¿Estás?", after(SECOND_MS * 20))).toMatchObject({ notify: false });

    await markRead(db, customerId, "student", after(SECOND_MS * 30));
    expect(await sendCoachMessage(db, customerId, "Hola de nuevo", after(SECOND_MS * 40))).toMatchObject({
      notify: true,
    });
  });

  test("the coach sends 40 in a row without a limit", async () => {
    for (let index = 0; index < 40; index += 1) {
      const result = await sendCoachMessage(db, customerId, `mensaje ${index}`, after(SECOND_MS * index));
      expect(result.kind).toBe("sent");
    }
    expect(await messageRows()).toHaveLength(40);
  });

  test("the same text within 9 seconds is a duplicate", async () => {
    await sendCoachMessage(db, customerId, "Hola", START);

    expect(await sendCoachMessage(db, customerId, "Hola", after(SECOND_MS * 9))).toEqual({ kind: "duplicate" });
    expect(await messageRows()).toHaveLength(1);
  });

  test("a student without a linked account gets no-account and leaves no row", async () => {
    const lonely = await insertTestCustomer(db, "Sin cuenta");

    expect(await sendCoachMessage(db, lonely, "Hola", START)).toEqual({ kind: "no-account" });
    expect(await conversationRows()).toHaveLength(0);
  });

  test("a student that does not exist, or an id that is not a uuid, gets no-account", async () => {
    expect(await sendCoachMessage(db, UNKNOWN_ID, "Hola", START)).toEqual({ kind: "no-account" });
    expect(await sendCoachMessage(db, "no-es-uuid", "Hola", START)).toEqual({ kind: "no-account" });
    expect(await conversationRows()).toHaveLength(0);
  });

  test("an invalid text is invalid", async () => {
    expect(await sendCoachMessage(db, customerId, "  ", START)).toEqual({ kind: "invalid" });
    expect(await conversationRows()).toHaveLength(0);
  });
});

describe("listMessages", () => {
  test("returns the messages from the oldest to the newest", async () => {
    await sendStudentMessage(db, customerId, "uno", START);
    await sendCoachMessage(db, customerId, "dos", after(SECOND_MS * 20));
    await sendStudentMessage(db, customerId, "tres", after(SECOND_MS * 40));

    const list = await listMessages(db, customerId);

    expect(list.map((message) => [message.sender, message.body])).toEqual([
      ["student", "uno"],
      ["coach", "dos"],
      ["student", "tres"],
    ]);
    expect(list[0].createdAt).toBe(START.toISOString());
  });

  test("is empty without a conversation, with an unknown id or an id that is not a uuid", async () => {
    expect(await listMessages(db, customerId)).toEqual([]);
    expect(await listMessages(db, UNKNOWN_ID)).toEqual([]);
    expect(await listMessages(db, "no-es-uuid")).toEqual([]);
  });

  test("never lists the messages of a student in the list of another", async () => {
    const other = await insertTestCustomer(db, "Beto");
    await insertTestAccount(db, { customerId: other });
    await sendStudentMessage(db, customerId, "de Ana", START);
    await sendStudentMessage(db, other, "de Beto", START);

    expect((await listMessages(db, customerId)).map((message) => message.body)).toEqual(["de Ana"]);
    expect((await listMessages(db, other)).map((message) => message.body)).toEqual(["de Beto"]);
  });
});

describe("unreadForStudent", () => {
  test("counts the messages of the coach after the last read of the student", async () => {
    await sendStudentMessage(db, customerId, "hola", START);
    await sendCoachMessage(db, customerId, "uno", after(SECOND_MS * 20));
    await sendCoachMessage(db, customerId, "dos", after(SECOND_MS * 40));
    expect(await unreadForStudent(db, customerId)).toBe(2);

    await markRead(db, customerId, "student", after(SECOND_MS * 50));
    expect(await unreadForStudent(db, customerId)).toBe(0);

    await sendCoachMessage(db, customerId, "tres", after(SECOND_MS * 60));
    expect(await unreadForStudent(db, customerId)).toBe(1);
  });

  test("counts all the messages of the coach when the student never read", async () => {
    await sendCoachMessage(db, customerId, "uno", START);

    expect(await unreadForStudent(db, customerId)).toBe(1);
  });

  test("is 0 without a conversation or with an id that is not a uuid", async () => {
    expect(await unreadForStudent(db, customerId)).toBe(0);
    expect(await unreadForStudent(db, "no-es-uuid")).toBe(0);
  });
});

describe("markRead", () => {
  test("does nothing, and creates no conversation, when there is none", async () => {
    await markRead(db, customerId, "student", START);
    await markRead(db, "no-es-uuid", "coach", START);

    expect(await conversationRows()).toHaveLength(0);
  });

  test("sets the mark of the reader only", async () => {
    await sendStudentMessage(db, customerId, "hola", START);

    await markRead(db, customerId, "coach", after(SECOND_MS * 5));

    const [conversation] = await conversationRows();
    expect(conversation.coachReadAt).toEqual(after(SECOND_MS * 5));
    expect(conversation.studentReadAt).toEqual(START);
  });
});

describe("listInbox and countUnreadConversations", () => {
  async function newStudent(name: string): Promise<string> {
    const id = await insertTestCustomer(db, name);
    await insertTestAccount(db, { customerId: id });
    return id;
  }

  test("lists first the conversations with something unread for the coach, then by last message, newest first", async () => {
    const beto = await newStudent("Beto");
    const carla = await newStudent("Carla");
    await sendStudentMessage(db, customerId, "de Ana", after(SECOND_MS * 10));
    await markRead(db, customerId, "coach", after(SECOND_MS * 11));
    await sendStudentMessage(db, beto, "de Beto", after(SECOND_MS * 20));
    await sendStudentMessage(db, carla, "de Carla", after(SECOND_MS * 30));
    await markRead(db, carla, "coach", after(SECOND_MS * 31));
    await sendCoachMessage(db, carla, "respuesta a Carla", after(SECOND_MS * 40));

    const inbox = await listInbox(db);

    expect(inbox.map((row) => row.customerName)).toEqual(["Beto", "Carla", "Ana"]);
    expect(inbox.map((row) => row.unread)).toEqual([1, 0, 0]);
  });

  test("the snippet is the first 80 characters of the last message in one line, and the sender is the last one", async () => {
    await sendStudentMessage(db, customerId, "viejo", START);
    await sendStudentMessage(db, customerId, `${"a".repeat(50)}\n${"b".repeat(50)}`, after(SECOND_MS * 20));

    const [row] = await listInbox(db);

    expect(row.snippet).toBe(`${"a".repeat(50)} ${"b".repeat(29)}`);
    expect(row.snippet).toHaveLength(80);
    expect(row.lastSender).toBe("student");
    expect(row.customerId).toBe(customerId);
    expect(row.lastMessageAt).toBe(after(SECOND_MS * 20).toISOString());
  });

  test("the unread count is the messages of the student after the last read of the coach", async () => {
    await sendStudentMessage(db, customerId, "uno", START);
    await sendStudentMessage(db, customerId, "dos", after(SECOND_MS * 20));
    await markRead(db, customerId, "coach", after(SECOND_MS * 30));
    await sendStudentMessage(db, customerId, "tres", after(SECOND_MS * 40));
    await sendStudentMessage(db, customerId, "cuatro", after(SECOND_MS * 60));

    const [row] = await listInbox(db);

    expect(row.unread).toBe(2);
  });

  test("countUnreadConversations counts conversations, not messages", async () => {
    const beto = await newStudent("Beto");
    await sendStudentMessage(db, customerId, "uno", START);
    await sendStudentMessage(db, customerId, "dos", after(SECOND_MS * 20));
    await sendStudentMessage(db, beto, "uno", START);
    await markRead(db, beto, "coach", after(SECOND_MS * 30));

    expect(await countUnreadConversations(db)).toBe(1);
  });

  test("an empty inbox", async () => {
    expect(await listInbox(db)).toEqual([]);
    expect(await countUnreadConversations(db)).toBe(0);
  });
});

describe("deleteConversation", () => {
  test("deletes the conversation with its messages and keeps the student and the sales", async () => {
    await insertTestSale(db, customerId);
    await sendStudentMessage(db, customerId, "hola", START);

    expect(await deleteConversation(db, customerId)).toBe(true);

    expect(await conversationRows()).toHaveLength(0);
    expect(await messageRows()).toHaveLength(0);
    expect(await db.select().from(customers).where(eq(customers.id, customerId))).toHaveLength(1);
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  test("returns false without a conversation or with an id that is not a uuid", async () => {
    expect(await deleteConversation(db, customerId)).toBe(false);
    expect(await deleteConversation(db, "no-es-uuid")).toBe(false);
  });

  test("deleting the student deletes the conversation", async () => {
    await sendStudentMessage(db, customerId, "hola", START);

    await db.delete(customers).where(eq(customers.id, customerId));

    expect(await conversationRows()).toHaveLength(0);
    expect(await messageRows()).toHaveLength(0);
  });
});

describe("purgeStaleConversations", () => {
  const NOW = new Date("2026-11-12T12:00:00.000Z");

  test("deletes a conversation of 24 months and a day and keeps one of 23 months", async () => {
    const recent = await insertTestCustomer(db, "Reciente");
    await insertTestAccount(db, { customerId: recent });
    await sendStudentMessage(db, customerId, "viejo", new Date("2024-11-11T11:59:00.000Z"));
    await sendStudentMessage(db, recent, "nuevo", new Date("2024-12-12T12:00:00.000Z"));

    await purgeStaleConversations(db, NOW);

    const left = await conversationRows();
    expect(left.map((row) => row.customerId)).toEqual([recent]);
    expect(await messageRows()).toHaveLength(1);
  });
});
