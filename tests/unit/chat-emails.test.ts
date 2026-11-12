import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { notifyChatMessage } from "@/chat/emails";
import { sendStudentMessage } from "@/chat/conversations";
import type { Db } from "@/db/client";
import type { EmailMessage } from "@/email/send";
import { SITE_URL } from "@/lib/site-url";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer } from "../helpers/portal";

const TALLAMI_EMAIL = "tallami-privado@example.com";
const STUDENT_EMAIL = "ana@example.com";
const UNIQUE_WORD = "palabraunicaxyz";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

type Sent = EmailMessage & { from: string };

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  vi.stubEnv("RESEND_API_KEY", "re_clave_de_prueba");
  vi.stubEnv("ADMIN_ALERT_EMAIL", TALLAMI_EMAIL);
  vi.stubEnv("ADMIN_ALERT_FROM", "Panel <onboarding@resend.dev>");
  vi.stubEnv("PUBLIC_EMAIL_FROM", "Tallami <hola@tallami.example>");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function recorder() {
  const sent: Sent[] = [];
  const transport = vi.fn(async (message: Sent) => void sent.push(message));
  return { sent, transport };
}

async function studentWithAccount(overrides: Parameters<typeof insertTestAccount>[1] = {}) {
  const customerId = await insertTestCustomer(db, "Ana Pérez");
  await insertTestAccount(db, { customerId, email: STUDENT_EMAIL, displayName: "Ana", ...overrides });
  return customerId;
}

describe("notifyChatMessage to Tallami", () => {
  test("sends one email to Tallami with the student's name in the subject and the link to the conversation", async () => {
    const customerId = await studentWithAccount();
    const { sent, transport } = recorder();

    await notifyChatMessage(db, customerId, "student", { transport });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(TALLAMI_EMAIL);
    expect(sent[0].subject).toBe("Mensaje nuevo de Ana Pérez");
    expect(sent[0].text).toContain(`${SITE_URL}/admin/mensajes/${customerId}`);
  });

  test("does not carry the text of the message", async () => {
    const customerId = await studentWithAccount();
    await sendStudentMessage(db, customerId, `hola ${UNIQUE_WORD}`);
    const { sent, transport } = recorder();

    await notifyChatMessage(db, customerId, "student", { transport });

    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent)).not.toContain(UNIQUE_WORD);
  });

  test("sends nothing and does not throw for a student that does not exist", async () => {
    const { sent, transport } = recorder();

    await expect(notifyChatMessage(db, UNKNOWN_ID, "student", { transport })).resolves.toBeUndefined();
    await expect(notifyChatMessage(db, "no-es-uuid", "student", { transport })).resolves.toBeUndefined();

    expect(sent).toHaveLength(0);
  });
});

describe("notifyChatMessage to the student", () => {
  test("sends the email to the account's address, in Spanish by default, with the link to the messages", async () => {
    const customerId = await studentWithAccount();
    const { sent, transport } = recorder();

    await notifyChatMessage(db, customerId, "coach", { transport });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(STUDENT_EMAIL);
    expect(sent[0].subject).toBe("Tallami te escribió");
    expect(sent[0].text).toContain("Ana");
    expect(sent[0].text).toContain(`${SITE_URL}/es/portal/mensajes`);
    expect(sent[0].text).toContain("Tomás Allami (Tallami)");
  });

  test("uses the language of the account", async () => {
    const customerId = await studentWithAccount({ locale: "pt" });
    const { sent, transport } = recorder();

    await notifyChatMessage(db, customerId, "coach", { transport });

    expect(sent[0].subject).not.toBe("Tallami te escribió");
    expect(sent[0].subject).toContain("Tallami");
    expect(sent[0].text).toContain(`${SITE_URL}/pt/portal/mensajes`);
  });

  test("does not carry the text of the message nor the address of Tallami", async () => {
    const customerId = await studentWithAccount();
    await sendStudentMessage(db, customerId, `hola ${UNIQUE_WORD}`);
    const { sent, transport } = recorder();

    await notifyChatMessage(db, customerId, "coach", { transport });

    const everything = JSON.stringify(sent);
    expect(everything).not.toContain(UNIQUE_WORD);
    expect(everything).not.toContain(TALLAMI_EMAIL);
  });

  test("sends nothing for an account without email", async () => {
    const customerId = await studentWithAccount({ email: null });
    const { sent, transport } = recorder();

    await notifyChatMessage(db, customerId, "coach", { transport });

    expect(sent).toHaveLength(0);
  });

  test("sends nothing for a student without an account", async () => {
    const customerId = await insertTestCustomer(db, "Sin cuenta");
    const { sent, transport } = recorder();

    await notifyChatMessage(db, customerId, "coach", { transport });

    expect(sent).toHaveLength(0);
  });

  test("sends nothing for an id that does not exist", async () => {
    const { sent, transport } = recorder();

    await notifyChatMessage(db, UNKNOWN_ID, "coach", { transport });

    expect(sent).toHaveLength(0);
  });
});

describe("a transport that throws", () => {
  test.each(["student", "coach"] as const)("does not propagate (%s)", async (sender) => {
    const customerId = await studentWithAccount();
    const transport = vi.fn(async () => {
      throw new Error("boom con ana@example.com");
    });

    await expect(notifyChatMessage(db, customerId, sender, { transport })).resolves.toBeUndefined();

    expect(vi.mocked(console.error).mock.calls.flat().map(String).join(" ")).not.toContain(STUDENT_EMAIL);
  });
});
