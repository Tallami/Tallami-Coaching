import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ConversationHeader } from "@/admin/chat/conversation-header";
import { InboxList } from "@/admin/chat/inbox-list";
import type { InboxRow } from "@/chat/conversations";

// Lo que dicen la bandeja y el encabezado de la conversación según el estado del alumno.

const ID = "11111111-1111-4111-8111-111111111111";

function header(account: Parameters<typeof ConversationHeader>[0]["account"]): string {
  return renderToStaticMarkup(createElement(ConversationHeader, { customerId: ID, studentName: "Ana", account }));
}

describe("ConversationHeader", () => {
  test("a student without account cannot receive messages and is sent to their page to be invited", () => {
    const html = header(null);

    expect(html).toContain("no puede recibir mensajes");
    expect(html).toContain(`href="/admin/alumnos/${ID}"`);
    expect(html).toContain("Invitarlo desde su ficha");
  });

  test("an account without email tells Tallami to warn them on Discord, and shows the Discord user", () => {
    const html = header({ provider: "discord", displayName: "Ana D", handle: "ana_d", email: null });

    expect(html).toContain("Este alumno no recibe avisos por email: avisale por Discord.");
    expect(html).toContain("ana_d");
    expect(html).toContain("Discord");
  });

  test("an account with email shows neither the warning nor the address", () => {
    const html = header({ provider: "google", displayName: "Ana G", handle: null, email: "ana@example.com" });

    expect(html).not.toContain("no recibe avisos");
    expect(html).not.toContain("ana@example.com");
    expect(html).not.toContain("no puede recibir");
  });
});

describe("InboxList", () => {
  const row = (overrides: Partial<InboxRow>): InboxRow => ({
    customerId: ID,
    customerName: "Ana",
    lastMessageAt: "2026-11-12T15:30:00.000Z",
    lastSender: "student",
    snippet: "hola",
    unread: 0,
    ...overrides,
  });
  const render = (r: InboxRow) => renderToStaticMarkup(createElement(InboxList, { rows: [r] }));

  test("an unread row says how many, in words, and is marked", () => {
    const html = render(row({ unread: 2 }));

    expect(html).toContain("2 sin leer");
    expect(html).toContain('data-unread="true"');
  });

  test("a read row has no unread mark, and shows the time in Argentina", () => {
    const html = render(row({}));

    expect(html).not.toContain("sin leer");
    expect(html).toContain('data-unread="false"');
    expect(html).toContain("12/11/2026, 12:30");
  });

  test("the start of the message is escaped text, never markup", () => {
    const html = render(row({ snippet: "<script>alert(1)</script>" }));

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
