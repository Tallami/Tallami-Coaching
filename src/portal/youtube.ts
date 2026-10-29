// De un link de YouTube se guarda solo el id del video: el portal arma el
// reproductor con ese id (`youtube-nocookie.com/embed/<id>`) y nunca con el link
// que pegó Tallami, así que nada de lo que venga en el link (parámetros, otro
// dominio parecido) llega a una página del alumno.
//
// Se aceptan las formas que YouTube da a un video, sobre https y en su dominio:
//   https://(www.|m.)youtube.com/watch?v=ID
//   https://youtu.be/ID
//   https://(www.|m.)youtube.com/live/ID
//   https://(www.|m.)youtube.com/shorts/ID
// El id son 11 caracteres de `A-Z a-z 0-9 _ -`. Todo lo demás es `null`.

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const SHORT_HOST = "youtu.be";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** `/live/ID` y `/shorts/ID`, con una barra al final si la trae. */
const PATH_WITH_KIND = /^\/(?:live|shorts)\/([A-Za-z0-9_-]{11})\/?$/;
/** `/ID`, con una barra al final si la trae (el link corto). */
const SHORT_PATH = /^\/([A-Za-z0-9_-]{11})\/?$/;

/** El id del video del link de YouTube `raw`, o `null` si no es un link de video de YouTube. */
export function youtubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  // Solo https, en el puerto de siempre y sin usuario ni clave (`https://youtube.com@otro.com/…`
  // ya tiene `otro.com` como dominio, pero un link con credenciales nunca es el que da YouTube).
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") return null;

  if (url.hostname === SHORT_HOST) return SHORT_PATH.exec(url.pathname)?.[1] ?? null;
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v");
    return id !== null && VIDEO_ID.test(id) ? id : null;
  }
  return PATH_WITH_KIND.exec(url.pathname)?.[1] ?? null;
}
