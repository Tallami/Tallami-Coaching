import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { PlayerChip } from "@/components/home/player-chip";
import { PLAYERS, type Player } from "@/content/players";

function render(player: Player): string {
  // Un `li` suelto: el que lo usa lo pone adentro de la lista.
  return renderToStaticMarkup(createElement("ul", null, createElement(PlayerChip, { player })));
}

describe("PlayerChip", () => {
  test("shows the round photo, decorative, next to the name", () => {
    const withPhoto = PLAYERS.find((player) => player.photo);
    expect(withPhoto).toBeDefined();
    if (!withPhoto) return;

    const markup = render(withPhoto);

    expect(markup.match(/<img /g)).toHaveLength(1);
    expect(markup).toContain('alt=""');
    expect(markup).toContain(withPhoto.name);
  });

  test("falls back to the initial on a circle when the player has no photo", () => {
    const markup = render({ name: "Nuevo", handle: "nuevo" });

    expect(markup).not.toContain("<img");
    expect(markup).toMatch(/<span class="[^"]*" aria-hidden="true">N<\/span>/);
    // El nombre se lee una vez; la inicial es decoración.
    expect(markup).toContain("Nuevo");
  });
});
