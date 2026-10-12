// Tweets de los jugadores que alimentan la sección "Reviews". Son tweets reales
// de ellos que etiquetan a @tallami1: no se inventan ni se editan.
//
// Para sumar uno: pegá su ID (el número al final del link, `x.com/<usuario>/
// status/<ID>`) en la lista. El texto, la imagen y el autor se bajan de X al
// construir la página (ver `src/lib/tweets.ts`); si el tweet se borra o X no
// responde, su tarjeta simplemente no aparece. El orden de esta lista no
// importa: el muro va del tweet más nuevo al más viejo.

export const TWEET_IDS: readonly string[] = [
  "2028263824235610348",
  "2052897717295210959",
  "1959441051686428791",
  "2032968988515271075",
  "2055799128924238181",
  "2104290558906868129",
  "2091212984919961996",
  "1964780083618685407",
  "1891289855725887688",
  "1964778870126878727",
];
