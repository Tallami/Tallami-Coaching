import { describe, expect, test } from "vitest";
import {
  AUTH_RECORD_RETENTION_MS,
  CHALLENGE_MS,
  ENROLLMENT_CODE_ALPHABET,
  ENROLLMENT_CODE_LENGTH,
  ENROLLMENT_CODE_MS,
  PASSKEY_NAME_MAX_LENGTH,
  PENDING_LOGIN_MS,
  REAUTH_WINDOW_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  SESSION_RETENTION_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from "@/admin/auth/policy";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// Los valores de la seguridad del ingreso al panel, tal como se decidieron. Si
// uno cambia, que cambie acá a propósito.
describe("login security policy", () => {
  test("a session closes after 30 minutes without use and 8 hours at most, and notes its use once a minute", () => {
    expect(SESSION_IDLE_MS).toBe(30 * MINUTE_MS);
    expect(SESSION_MAX_MS).toBe(8 * HOUR_MS);
    expect(SESSION_TOUCH_INTERVAL_MS).toBe(MINUTE_MS);
  });

  test("a half-done login, a challenge and a recent confirmation last five minutes", () => {
    expect(PENDING_LOGIN_MS).toBe(5 * MINUTE_MS);
    expect(CHALLENGE_MS).toBe(5 * MINUTE_MS);
    expect(REAUTH_WINDOW_MS).toBe(5 * MINUTE_MS);
  });

  test("a code for another device has ten characters and lasts ten minutes", () => {
    expect(ENROLLMENT_CODE_LENGTH).toBe(10);
    expect(ENROLLMENT_CODE_MS).toBe(10 * MINUTE_MS);
  });

  test("the code alphabet has 32 different characters and leaves out the ones that look alike", () => {
    expect(ENROLLMENT_CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    expect(new Set(ENROLLMENT_CODE_ALPHABET).size).toBe(32);
    for (const confusing of ["I", "O", "0", "1"]) {
      expect(ENROLLMENT_CODE_ALPHABET).not.toContain(confusing);
    }
  });

  test("session records are kept 30 days, and the rest of the records one day after they expire", () => {
    expect(SESSION_RETENTION_MS).toBe(30 * DAY_MS);
    expect(AUTH_RECORD_RETENTION_MS).toBe(DAY_MS);
  });

  test("a passkey name has up to 40 characters", () => {
    expect(PASSKEY_NAME_MAX_LENGTH).toBe(40);
  });
});
