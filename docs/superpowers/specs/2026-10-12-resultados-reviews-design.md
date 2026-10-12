# Home: resultados más visibles, reviews con tweets y franja de jugadores

Fecha: 12 de octubre de 2026. Cambios sobre la home que ya existe (`/es`, `/pt`, `/en`). Construido con Next.js 16.4 (App Router, `cacheComponents: true`), next-intl 4.14, Tailwind 4, Vitest y Playwright. Plan anterior: `docs/superpowers/plans/2026-10-12-base-nextjs.md`.

## Para qué

Tallami vio la home y quiere tres cosas:

1. **Que los mundiales presenciales se vean.** Los resultados de Globals y de la Esports World Cup son los más importantes (torneos presenciales mundiales) y hoy quedan en una lista chica debajo de la tabla de primeros puestos online.
2. **Mostrar prueba de que su coaching funciona.** Sus jugadores lo etiquetan (@tallami1) en X cuando publican un resultado. Tiene muchos tweets así y los va a ir pasando de a poco. No son resultados para la lista: son prueba de calidad.
3. **Sacar lo que sobra o queda mal:** la palabra "freelance", el recuadro de contadores de la portada, la caja de ganancias y la Academia Tallami. También cambia el precio de la Temporada Pro.

## Objetivos

- Resultados con la **opción B** que eligió Tallami: dos columnas lado a lado, "Campeonatos presenciales" a la izquierda (apenas más ancha, como en la maqueta: `1.1fr .9fr`) y "Campeonatos online" a la derecha. En celular, presenciales arriba.
- Nueva sección **"Reviews"** con un **muro en movimiento** de tweets reales de sus jugadores, en tarjetas con el diseño de la página. Cada tarjeta abre el tweet en X.
- Nueva **franja "Trabajé con"** debajo de la portada: foto y nombre de jugadores que entrenó, pasando sola como un carrusel.
- Sumar tweets y jugadores tiene que ser editar una lista, sin tocar componentes.

## No objetivos

- No cambia la lista de resultados: mismos 12 resultados, aunque los tweets mencionen otros (por ejemplo, el 1º de Randu en los Play-Ins de la EWC no se suma).
- No se traducen los tweets: se muestran tal cual los escribieron.
- No hay página aparte de reviews ni filtros por jugador o torneo.
- Los jugadores de la franja no llevan link a su perfil.

## Lo que sería un fracaso aunque funcione

- Que la página no se pueda construir o publicar porque X no responde. Si X falla, la sección de reviews se oculta o muestra los tweets que sí cargaron; nunca rompe el build.
- Mostrar algo que no es real: un tweet inventado, editado o atribuido a otra persona, o llamar "review" a algo que no publicó un jugador.
- Movimiento que no se pueda frenar: alguien en el celular o con teclado tiene que poder pausar el muro y la franja (WCAG 2.2.2).
- Que el muro ponga lenta la página en un celular de gama media.

## Restricciones

- Todo lo que fija el plan anterior sigue vigente: textos en español con voseo, pt-BR con "você", nada de precios escritos en los JSON de mensajes, resultados solo desde `src/content/`, páginas `/es`, `/pt` y `/en` estáticas, sin imágenes ni logos de Fortnite en el diseño del sitio (excepción: las imágenes de los tweets, ver "Reviews"), tests verdes antes de cada commit.
- Precios del `CLAUDE.md`, que se actualiza con este cambio (ver "Servicios").
- Fotos de jugadores y tweets: son contenido público de los propios jugadores, que entrenó Tallami. El `CLAUDE.md` dice que los jugadores del Excel autorizaron mostrar nombre y resultado.

## Lo que decidió Tallami

### Portada
- Se saca el recuadro con "3 títulos de FNCS / 6 primeros puestos". El título (`Entrená con el coach detrás de {count} títulos de FNCS`) queda igual.
- El zócalo con el nombre dice **"Coach de Fortnite competitivo, Argentina"** (pt "Coach de Fortnite competitivo, Argentina", en "Competitive Fortnite coach, Argentina").

### "Freelance"
- No aparece en ningún texto visible ni en los metadatos, en ningún idioma: zócalo, intro de resultados ("Resultados de jugadores que entrené. Autorizaron mostrar su nombre y resultado.") y descripción de la página ("…con Tallami, el coach detrás de {count} títulos de FNCS…").

### Resultados
- Título de la sección: "Resultados como coach" (sin cambios) y la intro de arriba.
- **Columna izquierda, "Campeonatos presenciales"** (pt "Campeonatos presenciais", en "In-person championships"), ordenada por puesto:
  1. 5º Esports World Cup · Reload
  2. 9º Esports World Cup · ESL
  3. 11º FNCS Globals · 2025
  4. 12º FNCS Globals · 2025
  5. 14º FNCS Globals · 2026
  6. 22º FNCS Globals · 2024
- **Columna derecha, "Campeonatos online"** (pt "Campeonatos online", en "Online championships"), en este orden y con jugadores:
  1. 1º FNCS CH6S1 · K1ng, Fazer y Phzin
  2. 1º FNCS CH5S3 · K1ng y Fazer
  3. 1º FNCS CH5S2 · Randu y Lewa
  4. 1º Reload Elite Series · Phzin y Edson
  5. 1º Reload Elite Series · Romero y Lewa
  6. 1º Second Chance · K1ng y Fazer
- Nombres: **"Reload Elite Series"** (antes "Reload Elite"), **"Esports World Cup"** escrito completo con "Reload" y "ESL" como etiqueta al costado.
- Se saca la caja de ganancias (USD 45.300).
- Look de la maqueta B: puestos presenciales grandes en dorado (más grandes que los online), etiqueta chica en dorado y mayúsculas sobre cada columna, líneas finas entre filas, superficie oscura. Referencia visual: `docs/superpowers/specs/2026-10-12-maquetas/resultados-y-servicios.html` (fragmento de la herramienta de maquetas: sin su marco, algunos estilos de contenedor no se ven, pero los bloques del sitio sí).

### Servicios
- Se saca **Academia Tallami** (servicio, textos, unidad "por mes" y CTA).
- **Temporada Pro: USD 2.500 fijos por equipo, toda la temporada, sin porcentaje de premios.** Se sigue entrando por aplicación.
- `CLAUDE.md`: sacar la fila de Academia, poner "Temporada Pro | 2500 por equipo, toda la temporada (por aplicación)" y actualizar el palmarés con "Reload Elite Series" y "Esports World Cup".

### Franja "Trabajé con"
- Va inmediatamente debajo de la portada, antes de los resultados, sobre superficie oscura.
- Etiqueta **"Trabajé con"** (pt "Trabalhei com", en "Worked with") y una fila de jugadores con foto redonda y nombre que pasa sola, en loop.
- Jugadores, en este orden (nombre visible y usuario de X):
  K1ng (`k1ng`), Fazer (`fazerfn`), Phzin (`Phzinfps1`), Randu (`randuimmm`), Lewa (`LewaFn`), Romero (`romerofdps`), Edson (`edsonmalado`), Tisco (`Tiscofn`), Diguera (`loud_diguera`), Mack (`mackftn`), Vadeal (`VadealFN`).
- El nombre visible es el de jugador, sin tag de equipo.

### Reviews (tweets)
- Sección nueva entre **Resultados** y **Servicios**, con título **"Reviews"** (igual en los tres idiomas) y bajada: es "Tweets de mis jugadores con su puesto y lo que ganaron. Tocá cualquiera para verlo en X." (pt y en traducidas).
- **Muro en movimiento:** dos filas de tarjetas que pasan solas en sentidos opuestos.
- Tarjeta con el diseño de la página (superficie `stage-2`, borde fino, dorado al pasar el mouse): foto de perfil, nombre y @usuario del autor, marca de X, texto del tweet, la imagen del tweet en 16:9, fecha y "Ver en X →". Toda la tarjeta es un link al tweet que abre en otra pestaña. En el texto, `@tallami1` va en dorado y las otras menciones en un azul claro. Referencia visual: opción C de `docs/superpowers/specs/2026-10-12-maquetas/reviews-y-franja.html`.
- **Las tarjetas muestran la imagen del tweet**, aunque sean capturas del juego (tabla de posiciones con títulos, logo de FNCS y personajes de Fortnite). Tallami lo decidió el 12-oct-2026 sabiendo que el análisis de mercado recomendaba no usar imágenes del juego: es contenido publicado por el propio jugador y se muestra como lo haría un tweet insertado. Esta es la única excepción a "sin imágenes ni logos de Fortnite"; el diseño propio del sitio sigue sin usarlas y el pie mantiene "No afiliado ni respaldado por Epic Games".
- Tweets iniciales (ID), de cualquier orden en la lista:
  `2028263824235610348`, `2052897717295210959`, `1959441051686428791`, `2032968988515271075`, `2055799128924238181`, `2104290558906868129`, `2091212984919961996`, `1964780083618685407`, `1891289855725887688`, `1964778870126878727`.

## Decisiones mías (Tallami las puede cambiar)

- **Orden del muro:** del tweet más nuevo al más viejo, repartidos alternando entre las dos filas.
- **Pausa del movimiento** (muro y franja): se frenan al pasar el mouse y cuando el foco del teclado entra; cada uno tiene un botón visible de pausa/reanudar (es "Pausar"/"Reanudar", pt "Pausar"/"Continuar", en "Pause"/"Play"). Con "reducir movimiento" activado no se mueven y se pueden deslizar a mano.
- **Teclado:** al tabular dentro del muro, la tarjeta enfocada queda entera a la vista. Las copias que hacen falta para el loop no son focusables ni las lee un lector de pantalla.
- **Datos de los tweets:** se bajan de X en el servidor (endpoint público de embeds, el mismo que usa `react-tweet` de Vercel; preferir su función `getTweet` de `react-tweet/api` a escribir una propia) y se cachean un día (`"use cache"` + `cacheLife`). Si un tweet no existe o falla, su tarjeta no aparece; si no carga ninguno, la sección no se muestra y la navegación no tiene link a ella.
- **Imágenes de tweets y avatares de autores:** con `next/image` desde `pbs.twimg.com` (se agrega a `images.remotePatterns`), así el navegador del visitante no le pide nada a X directamente.
- **Texto del tweet:** se saca el link `t.co` final que apunta a la imagen. Los emojis usan una fuente de emojis del sistema como respaldo.
- **Fotos de la franja:** archivos estáticos en `src/assets/players/<usuario en minúsculas>.jpg`, bajados una vez (la franja no depende de X al cargar). Se agrega un script que baja la foto de un jugador nuevo desde `https://unavatar.io/x/<usuario>` (devuelve la foto de perfil de X en JPEG; el 12-oct-2026 respondió para los 11 jugadores). La foto es opcional en la lista de jugadores: sin foto, se muestra un círculo con la inicial (como en la maqueta), así un jugador nuevo nunca rompe el build.
- **Rendimiento (criterio de aceptación):** Lighthouse en modo celular sobre `/es`: LCP menor a 2,5 s, TBT menor a 200 ms y CLS menor a 0,1. Las imágenes del muro cargan en diferido (`lazy`) y las copias para el loop se limitan a las necesarias.
- **Banderas en Windows:** Chrome y Edge en Windows muestran las banderas emoji como letras ("SA", "AR"). Se acepta así; no se suma una fuente extra.
- **Navegación:** se agrega "Reviews" entre "Resultados" y "Servicios", con ancla `#reviews`.
- **Temporada Pro:** unidad bajo el precio es "por equipo, toda la temporada"; la descripción pasa a "Coaching para tu dúo o trío durante toda la temporada. Se entra por aplicación."; la pregunta frecuente responde "Mandás una aplicación. Si quedás, son {price} por equipo por toda la temporada." Precio como argumento ICU desde `src/content/services.ts`.
- **Resultados:** con dos listas en lugar de tabla. La columna online deja de ser `<table>`; cada ítem se lee completo (puesto, torneo, etiqueta, jugadores). Se mantiene `translate="no"` en nombres de jugadores, torneos y etiquetas.
- **Tests de punta a punta sin red:** los tests e2e construyen el sitio con datos de tweets de un archivo de prueba guardado en el repo (activado por una variable de entorno), para no depender de X. La transformación de la respuesta de X a tarjeta tiene tests unitarios con una respuesta real grabada.

## Queda a criterio de quien lo construya

- Velocidad exacta del movimiento (que se pueda leer una tarjeta antes de que salga de la pantalla en celular) y si el muro anima con CSS o con JavaScript, siempre que cumpla pausa, teclado y "reducir movimiento".
- Tamaños exactos de tarjetas, foto y tipografía, respetando los tokens del diseño actual y la maqueta.
- Estructura de archivos de los componentes nuevos, siguiendo el patrón de `src/components/home/` y `src/content/`.
- Qué se borra del código viejo (contadores, ganancias, Academia, tabla) y cómo se actualizan los tests existentes.
