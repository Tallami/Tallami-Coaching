import { describe, expect, test } from "vitest";
import { parseStudentsQuery, studentsQueryString } from "@/admin/customers/query";

describe("parseStudentsQuery", () => {
  test("reads the search text and the page from the address", () => {
    expect(parseStudentsQuery({ q: "  ana  ", pagina: "3" })).toEqual({ q: "ana", page: 3 });
  });

  test("an empty address is the first page without search", () => {
    expect(parseStudentsQuery({})).toEqual({ page: 1 });
  });

  test("ignores what it does not understand instead of failing", () => {
    expect(parseStudentsQuery({ q: "   ", pagina: "dos" })).toEqual({ page: 1 });
    expect(parseStudentsQuery({ pagina: "-4" })).toEqual({ page: 1 });
    expect(parseStudentsQuery({ pagina: "0" })).toEqual({ page: 1 });
    expect(parseStudentsQuery({ pagina: "1e3" })).toEqual({ page: 1 });
  });

  test("takes the first value of a repeated parameter", () => {
    expect(parseStudentsQuery({ q: ["ana", "bruno"], pagina: ["2", "5"] })).toEqual({ q: "ana", page: 2 });
  });

  test("strips NUL characters and cuts the text at 100 characters", () => {
    expect(parseStudentsQuery({ q: "a\u0000b" })).toEqual({ q: "ab", page: 1 });
    expect(parseStudentsQuery({ q: "\u0000" })).toEqual({ page: 1 });
    expect(parseStudentsQuery({ q: "x".repeat(150) }).q).toHaveLength(100);
  });

  test("caps the page so the offset stays a safe integer", () => {
    expect(parseStudentsQuery({ pagina: "999999999" }).page).toBe(1_000_000);
  });

  test("a parameter named like an object property is just text", () => {
    expect(parseStudentsQuery(JSON.parse('{"__proto__": "x", "q": "__proto__"}'))).toEqual({
      q: "__proto__",
      page: 1,
    });
  });
});

describe("studentsQueryString", () => {
  test("is empty when there is nothing to write", () => {
    expect(studentsQueryString(undefined)).toBe("");
    expect(studentsQueryString("", 1)).toBe("");
  });

  test("writes the search text, encoded, and the page from the second on", () => {
    expect(studentsQueryString("ana pérez")).toBe("?q=ana+p%C3%A9rez");
    expect(studentsQueryString("ana", 2)).toBe("?q=ana&pagina=2");
    expect(studentsQueryString(undefined, 4)).toBe("?pagina=4");
  });
});
