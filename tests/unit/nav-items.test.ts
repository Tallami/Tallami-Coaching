import { describe, expect, test } from "vitest";
import { visibleNavItems } from "@/components/home/nav-items";

const hrefsOf = (hasReviews: boolean) =>
  visibleNavItems(hasReviews).map(({ href }) => href);

describe("visibleNavItems", () => {
  test("links to Reviews between Results and Services when there are cards", () => {
    expect(hrefsOf(true)).toEqual([
      "#results",
      "#reviews",
      "#services",
      "#how-it-works",
      "#faq",
    ]);
  });

  test("drops the Reviews link, and only that one, when there are no cards", () => {
    expect(hrefsOf(false)).toEqual([
      "#results",
      "#services",
      "#how-it-works",
      "#faq",
    ]);
  });

  test("keeps the label key of every link it returns", () => {
    expect(visibleNavItems(true).map(({ labelKey }) => labelKey)).toEqual([
      "results",
      "reviews",
      "services",
      "howItWorks",
      "faq",
    ]);
  });
});
