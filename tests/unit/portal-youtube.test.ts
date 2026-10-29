import { describe, expect, test } from "vitest";
import { youtubeVideoId } from "@/portal/youtube";

// De un link de YouTube se guarda solo el id del video (11 caracteres): el portal arma
// el reproductor con ese id y nunca con el link que pegó Tallami. Todo lo que no es
// exactamente una de las formas conocidas, sobre https y en el dominio de YouTube,
// vuelve `null`.

const ID = "dQw4w9WgXcQ";

describe("youtubeVideoId accepts the known forms", () => {
  test.each([
    ["watch", `https://www.youtube.com/watch?v=${ID}`],
    ["watch without www", `https://youtube.com/watch?v=${ID}`],
    ["watch on mobile", `https://m.youtube.com/watch?v=${ID}`],
    ["watch with more parameters before and after", `https://www.youtube.com/watch?feature=share&v=${ID}&t=42s&list=PL123`],
    ["short link", `https://youtu.be/${ID}`],
    ["short link with a time and a tracking id", `https://youtu.be/${ID}?t=42&si=abcdef`],
    ["live", `https://www.youtube.com/live/${ID}`],
    ["live with a tracking id", `https://www.youtube.com/live/${ID}?si=abcdef`],
    ["shorts", `https://www.youtube.com/shorts/${ID}`],
    ["a trailing slash after the id", `https://www.youtube.com/shorts/${ID}/`],
    ["a host written in capitals", `https://WWW.YouTube.COM/watch?v=${ID}`],
    ["spaces around the link", `  https://youtu.be/${ID}  `],
  ])("%s", (_label, link) => {
    expect(youtubeVideoId(link)).toBe(ID);
  });

  test("ids can have letters, digits, underscores and hyphens", () => {
    expect(youtubeVideoId("https://youtu.be/a_B-c1D2e3F")).toBe("a_B-c1D2e3F");
    expect(youtubeVideoId("https://youtu.be/-----------")).toBe("-----------");
    expect(youtubeVideoId("https://youtu.be/___________")).toBe("___________");
  });
});

describe("youtubeVideoId refuses everything else", () => {
  test.each([
    ["plain http", `http://www.youtube.com/watch?v=${ID}`],
    ["plain http, short link", `http://youtu.be/${ID}`],
    ["a different protocol", `ftp://www.youtube.com/watch?v=${ID}`],
    ["javascript", `javascript:alert(1)//www.youtube.com/watch?v=${ID}`],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["no protocol", `www.youtube.com/watch?v=${ID}`],
    ["a protocol-relative link", `//www.youtube.com/watch?v=${ID}`],
    ["a host that only starts like YouTube", `https://youtube.com.evil.com/watch?v=${ID}`],
    ["a host that only ends like YouTube", `https://notyoutube.com/watch?v=${ID}`],
    ["a host that ends like YouTube after a dot", `https://evil.youtube.com/watch?v=${ID}`],
    ["a host with the dot at the end", `https://www.youtube.com./watch?v=${ID}`],
    ["youtube as a user name", `https://www.youtube.com@evil.com/watch?v=${ID}`],
    ["a user name before the real host", `https://user:pass@www.youtube.com/watch?v=${ID}`],
    ["another port", `https://www.youtube.com:8443/watch?v=${ID}`],
    ["a short link of another site", `https://youtu.be.evil.com/${ID}`],
    ["the nocookie embed address", `https://www.youtube-nocookie.com/embed/${ID}`],
    ["the embed address", `https://www.youtube.com/embed/${ID}`],
    ["the channel page", "https://www.youtube.com/@tallami1"],
    ["the playlist page", "https://www.youtube.com/playlist?list=PL1234567890"],
    ["watch without an id", "https://www.youtube.com/watch"],
    ["watch with an empty id", "https://www.youtube.com/watch?v="],
    ["watch with the id in the path", `https://www.youtube.com/watch/${ID}`],
    ["watch with the id in the fragment", `https://www.youtube.com/watch#v=${ID}`],
    ["an id one character short", "https://youtu.be/dQw4w9WgXc"],
    ["an id one character long", "https://youtu.be/dQw4w9WgXcQQ"],
    ["an id one character short, in watch", "https://www.youtube.com/watch?v=dQw4w9WgXc"],
    ["an id one character long, in watch", "https://www.youtube.com/watch?v=dQw4w9WgXcQQ"],
    ["an id with a character that is not allowed", "https://youtu.be/dQw4w9WgXc!"],
    ["an id with an encoded slash", "https://youtu.be/dQw4w9W%2FXcQ"],
    ["an id with a dot", "https://youtu.be/dQw4w9W.XcQ"],
    ["a second path segment after the id", `https://youtu.be/${ID}/extra`],
    ["live without an id", "https://www.youtube.com/live/"],
    ["shorts without an id", "https://www.youtube.com/shorts"],
    ["the bare short host", "https://youtu.be/"],
    ["the bare home page", "https://www.youtube.com/"],
    ["an empty text", ""],
    ["only spaces", "   "],
    ["a text that is not a link", "mirá este video"],
    ["only the id", ID],
  ])("%s", (_label, link) => {
    expect(youtubeVideoId(link)).toBeNull();
  });
});
