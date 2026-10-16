import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { BookingLink } from "@/components/home/booking-link";
import { INTEREST_ENDPOINT, sendInterest, type InterestTransport } from "@/components/home/send-interest";

describe("BookingLink markup", () => {
  test("renders the same link the page had before, with nothing added", () => {
    const markup = renderToStaticMarkup(
      createElement(
        BookingLink,
        { item: "lesson", locale: "es", href: "#services", className: "btn", "data-slot": "button" } as never,
        "Reservar",
      ),
    );

    expect(markup).toBe('<a href="#services" class="btn" data-slot="button">Reservar</a>');
  });

  test("does not leak its own props into the page", () => {
    const markup = renderToStaticMarkup(
      createElement(BookingLink, { item: "proSeason", locale: "pt", href: "#services" }, "Aplicar"),
    );

    expect(markup).not.toContain("proSeason");
    expect(markup).not.toContain('locale="');
    expect(markup).not.toContain("onclick");
  });
});

describe("sendInterest", () => {
  const EXPECTED_BODY = '{"item":"vodRecorded","locale":"pt"}';

  function transport(overrides: Partial<InterestTransport> = {}): Required<InterestTransport> {
    return {
      sendBeacon: vi.fn(() => true),
      fetch: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
      ...overrides,
    } as Required<InterestTransport>;
  }

  test("sends one beacon with the JSON body and no fetch when the beacon is queued", async () => {
    const used = transport();

    sendInterest("vodRecorded", "pt", used);

    expect(used.sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = vi.mocked(used.sendBeacon).mock.calls[0] as [string, Blob];
    expect(url).toBe(INTEREST_ENDPOINT);
    expect(INTEREST_ENDPOINT).toBe("/api/interest");
    expect(blob.type).toBe("application/json");
    expect(await blob.text()).toBe(EXPECTED_BODY);
    expect(used.fetch).not.toHaveBeenCalled();
  });

  test("falls back to a keepalive fetch when the browser refuses the beacon", () => {
    const used = transport({ sendBeacon: vi.fn(() => false) });

    sendInterest("vodRecorded", "pt", used);

    expect(used.fetch).toHaveBeenCalledTimes(1);
    expect(used.fetch).toHaveBeenCalledWith(INTEREST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: EXPECTED_BODY,
      keepalive: true,
    });
  });

  test("falls back to fetch when there is no sendBeacon at all", () => {
    const used = transport();
    const withoutBeacon: InterestTransport = { fetch: used.fetch };

    sendInterest("vodRecorded", "pt", withoutBeacon);

    expect(used.fetch).toHaveBeenCalledTimes(1);
  });

  test("never throws, whatever fails: the link must always work", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    const rejecting = vi.fn(() => Promise.reject(new Error("offline")));

    expect(() => sendInterest("lesson", "es", { sendBeacon: boom, fetch: rejecting })).not.toThrow();
    expect(() => sendInterest("lesson", "es", { sendBeacon: () => false, fetch: boom })).not.toThrow();
    expect(() => sendInterest("lesson", "es", {})).not.toThrow();
    // El rechazo de fetch queda atendido: no hay promesas sueltas que rompan la página.
    await Promise.resolve();
  });
});
