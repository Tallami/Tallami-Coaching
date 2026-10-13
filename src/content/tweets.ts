// Tweets de los jugadores que alimentan la sección "Reviews". Son tweets reales
// de ellos que etiquetan a @tallami1: no se inventan ni se editan.
//
// Para sumar uno:
//   1. Pegá su ID (el número al final del link, `x.com/<usuario>/status/<ID>`)
//      en la lista. El orden no importa: el muro va del tweet más nuevo al más
//      viejo.
//   2. Corré `npm run tweets:record -- <ID>`: guarda la respuesta de X en
//      `src/content/tweet-snapshots/<ID>.json` y rehace el índice de esa
//      carpeta (`index.ts`). Es la copia que la web usa si X falla al armar la
//      página, y la que leen los tests en lugar de la red. Hay que subir esos
//      archivos junto con el cambio.
//   3. Corré `npm run test` y `npm run test:e2e`. El autor del tweet tiene que
//      estar en `src/content/players.ts` y el texto tiene que etiquetar a
//      @tallami1; si no, el test lo avisa.
//
// Para sacar uno: borrá su ID de la lista y su archivo de `tweet-snapshots`, y
// corré `npm run tweets:index` para rehacer el índice.
//
// El texto, la imagen y el autor se bajan de X al construir la página (ver
// `src/lib/tweets.ts`) y se refrescan una vez por día. Si el tweet se borra (o
// pasa a ser privado), su tarjeta no aparece. Si X falla (red, tiempo agotado,
// error del servidor), se usa la copia guardada de ese tweet.

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
