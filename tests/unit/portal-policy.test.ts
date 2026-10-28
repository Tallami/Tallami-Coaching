import { describe, expect, test } from "vitest";
import {
  DELIVERY_KINDS,
  DELIVERY_PDF_MAX_BYTES,
  DELIVERY_TITLE_MAX_LENGTH,
  PORTAL_INVITE_MS,
  PORTAL_OAUTH_FLOW_MS,
  PORTAL_PROVIDERS,
  PORTAL_SESSION_MS,
} from "@/portal/policy";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

describe("portal policy", () => {
  test("a student session lasts 30 days", () => {
    expect(PORTAL_SESSION_MS).toBe(30 * DAY_MS);
  });

  test("the OAuth flow lasts 10 minutes", () => {
    expect(PORTAL_OAUTH_FLOW_MS).toBe(10 * MINUTE_MS);
  });

  test("an invitation lasts 14 days", () => {
    expect(PORTAL_INVITE_MS).toBe(14 * DAY_MS);
  });

  test("a PDF is 4 MB at most, and a title has 1 to 120 characters", () => {
    expect(DELIVERY_PDF_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(DELIVERY_TITLE_MAX_LENGTH).toBe(120);
  });

  test("the closed lists are the ones of the design", () => {
    expect(PORTAL_PROVIDERS).toEqual(["discord", "google", "test"]);
    expect(DELIVERY_KINDS).toEqual(["youtube", "pdf", "link"]);
  });
});
