import postgres from "postgres";
import { afterEach, describe, expect, test, vi } from "vitest";
import { withEncryptedConnection } from "@/db/migrate-url";

// `npm run db:migrate` se conecta con drizzle-kit, que con una `url` no acepta la
// opción `ssl` (solo con host/usuario/etc. por separado): el cifrado tiene que ir
// en la propia URL, como `sslmode`, que postgres.js entiende.

const POOLER = "postgres://postgres.abcdef:clave@aws-0-sa-east-1.pooler.supabase.com:5432/postgres";

function sslmodeOf(url: string): string | null {
  return new URL(url).searchParams.get("sslmode");
}

describe("withEncryptedConnection", () => {
  test("adds sslmode=require to a URL that does not say anything about it", () => {
    expect(withEncryptedConnection(POOLER)).toBe(`${POOLER}?sslmode=require`);
  });

  test("keeps the rest of the URL as it was, including the user and a percent-encoded password", () => {
    const url = "postgres://postgres.abcdef:p%40ss%3Aword@host.example.com:5432/postgres";

    expect(withEncryptedConnection(url)).toBe(`${url}?sslmode=require`);
  });

  test("keeps the other query parameters", () => {
    const result = withEncryptedConnection(`${POOLER}?connect_timeout=10&application_name=migrar`);
    const params = new URL(result).searchParams;

    expect(params.get("connect_timeout")).toBe("10");
    expect(params.get("application_name")).toBe("migrar");
    expect(params.get("sslmode")).toBe("require");
  });

  test.each(["disable", "allow", "prefer", "no-verify", "algo-raro", ""])(
    "turns a weaker or unknown sslmode (%j) into require",
    (mode) => {
      const result = withEncryptedConnection(`${POOLER}?sslmode=${mode}`);

      expect(sslmodeOf(result)).toBe("require");
      expect(result.match(/sslmode=/g)).toHaveLength(1);
    },
  );

  test.each(["false", "disable", "0"])("also overrides the ssl=%s alias that postgres.js reads", (value) => {
    const result = withEncryptedConnection(`${POOLER}?ssl=${value}`);

    expect(sslmodeOf(result)).toBe("require");
    expect(new URL(result).searchParams.has("ssl")).toBe(false);
  });

  test.each(["require", "verify-ca", "verify-full"])("leaves %s as it is: it is already encrypted", (mode) => {
    expect(sslmodeOf(withEncryptedConnection(`${POOLER}?sslmode=${mode}`))).toBe(mode);
  });

  test("is what postgres.js, the driver drizzle-kit uses with a URL, reads as an encrypted connection", async () => {
    // drizzle-kit llama a `postgres(url, { max: 1 })`: la URL sola tiene que bastar.
    for (const url of [POOLER, `${POOLER}?sslmode=disable`, `${POOLER}?ssl=false`]) {
      const client = postgres(withEncryptedConnection(url), { max: 1 });
      expect((client.options as { ssl: unknown }).ssl).toBe("require");
      await client.end();
    }
  });

  test("is idempotent", () => {
    const once = withEncryptedConnection(POOLER);

    expect(withEncryptedConnection(once)).toBe(once);
  });
});

describe("drizzle.config.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test("hands drizzle-kit the DATABASE_URL with an encrypted connection", async () => {
    vi.stubEnv("DATABASE_URL", POOLER);

    const { default: config } = await import("../../drizzle.config");

    const credentials = (config as { dbCredentials?: { url?: string } }).dbCredentials;
    expect(credentials?.url).toBe(`${POOLER}?sslmode=require`);
  });

  test("without DATABASE_URL (generate only reads the schema) it has no credentials", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const { default: config } = await import("../../drizzle.config");

    expect((config as { dbCredentials?: unknown }).dbCredentials).toBeUndefined();
  });
});
