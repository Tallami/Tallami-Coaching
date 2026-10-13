// Tweets de los jugadores que alimentan la sección "Reviews". Son tweets reales
// de ellos que etiquetan a @tallami1: no se inventan ni se editan.
//
// Para sumar uno:
//   1. Pegá su ID (el número al final del link, `x.com/<usuario>/status/<ID>`)
//      en la lista. El orden no importa: el muro va del tweet más nuevo al más
//      viejo.
//   2. Corré `npm run tweets:record -- <ID>`: graba la respuesta de X en
//      `tests/fixtures/tweets/<ID>.json`, que usan los tests y el build de los
//      e2e en lugar de la red. Hay que subir ese archivo junto con el cambio.
//   3. Corré `npm run test` y `npm run test:e2e`. El autor del tweet tiene que
//      estar en `src/content/players.ts` y el texto tiene que etiquetar a
//      @tallami1; si no, el test lo avisa.
//
// El texto, la imagen y el autor se bajan de X al construir la página (ver
// `src/lib/tweets.ts`) y se refrescan una vez por día; si el tweet se borra o X
// no responde, su tarjeta simplemente no aparece.

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
