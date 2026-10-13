import { describe, expect, test } from "vitest";
import { ReviewsWall } from "@/components/home/reviews-wall";

describe("ReviewsWall", () => {
  test("renders nothing without cards, so there is no section to link to", async () => {
    // Antes de pedir nada a next-intl: no necesita una petición ni mensajes.
    expect(await ReviewsWall({ cards: [] })).toBeNull();
  });
});
