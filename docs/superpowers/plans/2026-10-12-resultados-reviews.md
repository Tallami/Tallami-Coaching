# Resultados, reviews con tweets y franja de jugadores — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a la home los cambios aprobados: resultados en dos columnas, sin "freelance", sin contadores ni ganancias, sin Academia, Temporada Pro a USD 2.500 por equipo, franja "Trabajé con" y sección "Reviews" con un muro de tweets en movimiento.

**Architecture:** Los datos siguen en `src/content/` (resultados, servicios, jugadores, IDs de tweets). Los tweets se bajan en el servidor con `getTweet` de `react-tweet/api`, se transforman a un tipo propio `TweetCard` y se cachean un día con `"use cache"`. El movimiento (franja y muro) sale de un único par de componentes de cliente reutilizables (`MarqueeGroup` + `MarqueeRow`) que resuelven pausa, teclado, "reducir movimiento" y copias ocultas. Todo lo demás son Server Components.

**Tech Stack:** Next.js 16.4 (App Router, `cacheComponents`) · next-intl 4.14 · Tailwind 4 + CSS Modules · react-tweet 3.3 (solo la API de datos) · Vitest · Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-12-resultados-reviews-design.md` (maquetas en `docs/superpowers/specs/2026-10-12-maquetas/`). Plan anterior con las convenciones del proyecto: `docs/superpowers/plans/2026-10-12-base-nextjs.md`.

## Global Constraints

- Rama `feat/resultados-reviews`. Agregar archivos **por ruta explícita**; nunca `git add -A` ni `git add .`. Commits `feat:`/`fix:`/`test:`/`chore:` terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Español con voseo rioplatense; pt-BR con "você"; en neutro. No se traducen nombres de jugadores, torneos, temporadas, "Reviews", "Temporada Pro" ni "Tallami".
- Ningún precio ni porcentaje escrito en los JSON de mensajes: llegan como argumento ICU desde `src/content/`. Resultados solo desde `src/content/results.ts`.
- La palabra "freelance"/"freelancer" no aparece en ningún texto ni metadato, en ningún idioma.
- `/es`, `/pt` y `/en` siguen prerenderizadas estáticas; la 404 global sigue igual.
- Sin imágenes ni logos de Fortnite en el diseño propio. Única excepción: la imagen de cada tweet.
- Todo movimiento se puede pausar (mouse, foco de teclado y botón visible de al menos 44×44 px) y no se mueve con `prefers-reduced-motion: reduce`.
- Si X falla, el build y la página funcionan: tarjetas que no cargan se omiten; sin tarjetas, no hay sección ni link de navegación.
- Los e2e no dependen de la red: el build de Playwright usa respuestas de tweets grabadas (`TWEETS_FIXTURE_DIR`).
- Archivos con regex o barras invertidas: escribirlos con Write/Edit, nunca con heredoc. Servidores: cerrarlos por PID, nunca `taskkill /IM node.exe`.

## Review Focus

1. **X no responde o un tweet fue borrado al construir:** el build termina, esa tarjeta no aparece y, si no queda ninguna, desaparecen la sección y su link. → tests unitarios en la Tarea 4.
2. **Usuario con teclado dentro del muro:** el muro se frena, la tarjeta enfocada queda entera a la vista y las copias del loop no reciben foco. → e2e en la Tarea 5 (y en la 3 para la franja).
3. **Celular con "reducir movimiento":** nada se mueve y las filas se pueden deslizar a mano. → e2e en las Tareas 3 y 5.
4. **Texto de tweet con `&amp;`, `&lt;` o `<3`:** se muestra como texto, decodificado y sin HTML inyectado. → test unitario en la Tarea 4.
5. **Celular de 320 px en portugués con la franja y el muro:** sin scroll horizontal de página. → `tests/e2e/quality.spec.ts` (ya recorre 5 anchos × 3 idiomas), verificado en la Tarea 6.

---

## Estructura de archivos

```
src/content/results.ts            WINS (online), LAN_RESULTS (presenciales), FNCS_TITLES
src/content/services.ts           sin academy; PRO_SEASON { priceUsd: 2500 }
src/content/players.ts            PLAYERS (nombre, usuario, foto opcional)
src/content/tweets.ts             TWEET_IDS
src/assets/players/<usuario>.jpg  11 fotos (minúsculas)
scripts/fetch-player-photo.mjs    baja una foto desde unavatar.io
src/lib/tweets.ts                 TweetCard, toTweetCard, tweetTextParts, fetchTweetCards, getTweetCards
tests/fixtures/tweets/<id>.json   respuestas grabadas de X para los 10 tweets
src/components/motion/marquee.tsx MarqueeGroup + MarqueeRow (cliente) + marquee.module.css
src/components/home/results-board.tsx (+ .module.css)   reescrito: dos listas
src/components/home/players-strip.tsx (+ .module.css)   franja "Trabajé con"
src/components/home/tweet-card.tsx (+ .module.css)      tarjeta
src/components/home/reviews-wall.tsx (+ .module.css)    sección "Reviews"
```

---

### Task 1: Resultados en dos columnas

**Files:**
- Modify: `src/content/results.ts`, `src/components/home/results-board.tsx`, `src/components/home/results-board.module.css`, `messages/{es,pt,en}.json` (namespace `Results`)
- Test: `tests/unit/content.test.ts`, `tests/e2e/home-stage.spec.ts`

**Interfaces:**
- Produces:
  - `type Win = { event: "FNCS" | "Reload Elite Series" | "Second Chance"; season?: string; players: readonly string[] }` y `WINS` (mismo orden que hoy, con "Reload Elite Series").
  - `type LanResult = { place: number; event: "Esports World Cup" | "FNCS Globals"; label: string }` y `LAN_RESULTS`, ordenado por puesto.
  - `FNCS_TITLES` se mantiene. Se borran `OTHER_RESULTS`, `OtherResult`, `COACHING_EARNINGS_USD`, `EARNINGS_SINCE` y `FIRST_PLACES` (el hero los deja de usar en la Tarea 2; mientras tanto, `hero.tsx` puede seguir importando `FIRST_PLACES`, así que **dejá `FIRST_PLACES` exportado** hasta la Tarea 2).
  - Mensajes `Results`: `title`, `intro` ("Resultados de jugadores que entrené. Autorizaron mostrar su nombre y resultado."), `lanTitle` (es "Campeonatos presenciales", pt "Campeonatos presenciais", en "In-person championships"), `onlineTitle` (es "Campeonatos online", pt "Campeonatos online", en "Online championships"). Se borran `caption`, `columnPlace`, `columnEvent`, `columnPlayers`, `othersTitle`, `earnings`.

Diseño: opción B de `docs/superpowers/specs/2026-10-12-maquetas/resultados-y-servicios.html`. Dos `<ul>` en columnas `1.1fr .9fr` (una sola columna, presenciales primero, en ≤900 px), cada una con un `h3` en dorado y mayúsculas. Puestos presenciales grandes en dorado; online más chicos. Se mantiene `translate="no"` en jugadores, torneos y etiquetas, y `formatPlace`/`formatListParts`. La sección conserva `id="results"` y su `h2`.

- [ ] **Step 1: Tests que fallan**

`tests/unit/content.test.ts`: reemplazar los tests de `OTHER_RESULTS`, ganancias y `FIRST_PLACES` por:
```ts
test("online wins use the full Reload Elite Series name", () =>
  expect(WINS.map((w) => w.event)).toEqual([
    "FNCS", "FNCS", "FNCS", "Reload Elite Series", "Reload Elite Series", "Second Chance",
  ]));
test("in-person results match CLAUDE.md, ordered by place", () =>
  expect(LAN_RESULTS).toEqual([
    { place: 5, event: "Esports World Cup", label: "Reload" },
    { place: 9, event: "Esports World Cup", label: "ESL" },
    { place: 11, event: "FNCS Globals", label: "2025" },
    { place: 12, event: "FNCS Globals", label: "2025" },
    { place: 14, event: "FNCS Globals", label: "2026" },
    { place: 22, event: "FNCS Globals", label: "2024" },
  ]));
```
`tests/e2e/home-stage.spec.ts`: reemplazar los tests de tabla, "otros resultados" y ganancias por:
```ts
test("in-person championships list comes first, ordered by place", …)
  // /es: lista bajo el h3 "Campeonatos presenciales"; textos normalizados (espacios colapsados):
  // ["5º Esports World Cup Reload","9º Esports World Cup ESL","11º FNCS Globals 2025",
  //  "12º FNCS Globals 2025","14º FNCS Globals 2026","22º FNCS Globals 2024"]
  // /en: el primero "5th Esports World Cup Reload", h3 "In-person championships"
test("online championships list shows the six wins with players per locale", …)
  // /es: 6 ítems bajo "Campeonatos online"; el 1º contiene "1º","FNCS","CH6S1","K1ng, Fazer y Phzin";
  // el 4º contiene "Reload Elite Series" y "Phzin y Edson"; /pt el 1º "K1ng, Fazer e Phzin"; /en "1st"
test("results no longer show the earnings box", …)
  // /es, /pt, /en: #results no contiene "45.300", "45,300" ni "CH5S4"
test("in-person list sits before the online list on phones", …)
  // 375px: la caja de "Campeonatos presenciales" está arriba (y menor) que la de "Campeonatos online"
```

- [ ] **Step 2: Correr y ver que fallan** — `npx vitest run tests/unit/content.test.ts` y `npx playwright test tests/e2e/home-stage.spec.ts` → FAIL.

- [ ] **Step 3: Implementar** datos, mensajes en los tres idiomas y el nuevo `ResultsBoard` (borrar la tabla, sus roles ARIA y los estilos que ya no se usan).

- [ ] **Step 4: Correr y ver que pasa** — `npm run test && npx playwright test && npm run lint && npm run typecheck` → PASS. Ajustar en `tests/e2e/quality.spec.ts` solo los tests de la tabla apilada que ya no aplica (borrarlos; los de scroll y axe quedan).

- [ ] **Step 5: Commit** — `feat: resultados en dos columnas con campeonatos presenciales primero`.

---

### Task 2: Portada, servicios y textos (sin "freelance", contadores ni Academia)

**Files:**
- Modify: `src/components/home/hero.tsx`, `src/components/home/hero.module.css`, `src/content/results.ts` (borrar `FIRST_PLACES`), `src/content/services.ts`, `src/components/home/services-menu.tsx`, `src/components/home/faq.tsx`, `messages/{es,pt,en}.json`, `CLAUDE.md`
- Test: `tests/unit/content.test.ts`, `tests/unit/messages.test.ts`, `tests/e2e/home-stage.spec.ts`, `tests/e2e/home-paper.spec.ts`, `tests/e2e/seo.spec.ts`

**Interfaces:**
- Consumes: `FNCS_TITLES` (Tarea 1).
- Produces: `ServiceId` sin `"academy"`; `PriceUnit = "perTeam"`; `PRO_SEASON = { priceUsd: 2500 } as const`.
- Mensajes:
  - `Hero.role`: es "Coach de Fortnite competitivo, Argentina", pt "Coach de Fortnite competitivo, Argentina", en "Competitive Fortnite coach, Argentina". Se borran `Hero.summaryLabel`, `titlesLabel`, `firstPlacesLabel`.
  - `Metadata.description` (es): "Coaching de Fortnite competitivo con Tallami, el coach detrás de {count} títulos de FNCS. VOD reviews, clases 1 a 1, planes de juego y coaching de torneo." (pt y en, igual sin "freelance").
  - Se borran `Services.items.academy` y `Services.units.perMonth`.
  - `Services.pro.unit`: es "por equipo, toda la temporada" (sin argumentos). `Services.pro.description`: es "Coaching para tu dúo o trío durante toda la temporada. Se entra por aplicación."
  - `Faq.items.pro.answer`: es "Mandás una aplicación. Si quedás, son {price} por equipo por toda la temporada." (solo `{price}`).
- `CLAUDE.md`: palmarés con "Reload Elite Series" y "Esports World Cup (ESL 9º, Reload 5º)"; tabla de precios sin Academia y con "Temporada Pro | 2500 por equipo, toda la temporada (por aplicación)".

- [ ] **Step 1: Tests que fallan**
```ts
// tests/unit/content.test.ts
test("service prices match CLAUDE.md", () => expect(SERVICES).toEqual([
  { id: "vodRecorded", priceUsd: 30 }, { id: "vodLive", priceUsd: 45 }, { id: "lesson", priceUsd: 40 },
  { id: "gamePlan", priceUsd: 120 }, { id: "tournament", priceUsd: 150, unit: "perTeam" },
]));
test("pro season is a flat team price", () => expect(PRO_SEASON).toEqual({ priceUsd: 2500 }));
```
```ts
// tests/e2e (home-stage / home-paper / seo, según corresponda)
test("no text or metadata says freelance", …)
  // /es, /pt, /en: body innerText y meta[name=description] sin /freelanc/i
test("hero has no results counters", …)
  // /es: no existe el grupo "Resumen de resultados como coach"; zócalo "Coach de Fortnite competitivo, Argentina"
test("services list five prices and the pro season last", …)
  // /es #services [data-testid=price] empiezan con ["USD 30","USD 45","USD 40","USD 120","USD 150","USD 2.500"];
  // /en el último "USD 2,500"; ninguna página contiene "Academia Tallami"; #services sin "%"
test("pro season shows the team unit and the faq answer", …)
  // /es: "por equipo, toda la temporada"; respuesta FAQ pro =
  // "Mandás una aplicación. Si quedás, son USD 2.500 por equipo por toda la temporada."
```
Actualizar los tests existentes que nombran la Academia (regex de CTAs en `home-paper.spec.ts`), los contadores y el `{percent}` de la FAQ (`messages.test.ts`).

- [ ] **Step 2: Correr y ver que fallan.**
- [ ] **Step 3: Implementar** (borrar el recuadro `.bug` del hero y sus estilos; servicios, FAQ, mensajes en los tres idiomas y `CLAUDE.md`).
- [ ] **Step 4: Correr y ver que pasa** — `npm run test && npx playwright test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `feat: sin contadores, ganancias, Academia ni "freelance"; Temporada Pro a USD 2.500 por equipo`.

---

### Task 3: Componentes de movimiento y franja "Trabajé con"

**Files:**
- Create: `src/components/motion/marquee.tsx`, `src/components/motion/marquee.module.css`, `src/content/players.ts`, `src/assets/players/*.jpg` (11), `scripts/fetch-player-photo.mjs`, `src/components/home/players-strip.tsx`, `src/components/home/players-strip.module.css`
- Modify: `src/app/[locale]/page.tsx` (franja justo después de `<Hero />`), `messages/{es,pt,en}.json` (namespace `Players`), `package.json` (script `players:photo`)
- Test: `tests/unit/content.test.ts`, `tests/e2e/players-strip.spec.ts`

**Interfaces:**
- Produces:
  - `MarqueeGroup({ pauseLabel: string; resumeLabel: string; label?: string; children: ReactNode; className?: string })`: `"use client"`; guarda `paused` en contexto, renderiza un `<button type="button" aria-pressed>` visible (≥44×44 px) que alterna entre `pauseLabel` y `resumeLabel`; pausa también mientras el puntero está encima o el foco está adentro (`focus-within`).
  - `MarqueeRow({ direction: "left" | "right"; durationSeconds: number; children: ReactNode })`: renderiza `children` una vez visible y una copia para el loop con `aria-hidden="true"` e `inert`; se mueve en `direction` mientras el grupo no esté pausado; con `prefers-reduced-motion: reduce` no anima y la fila es desplazable (`overflow-x: auto`). Con foco de teclado dentro, el elemento enfocado tiene que quedar entero dentro de la fila visible (técnica a criterio: animación CSS + modo manual al enfocar, o desplazamiento por JS).
  - `type Player = { name: string; handle: string; photo?: StaticImageData }` y `PLAYERS` en este orden: K1ng `k1ng`, Fazer `fazerfn`, Phzin `Phzinfps1`, Randu `randuimmm`, Lewa `LewaFn`, Romero `romerofdps`, Edson `edsonmalado`, Tisco `Tiscofn`, Diguera `loud_diguera`, Mack `mackftn`, Vadeal `VadealFN`.
  - Mensajes `Players`: `label` (es "Trabajé con", pt "Trabalhei com", en "Worked with"), `pause` (es "Pausar", pt "Pausar", en "Pause"), `resume` (es "Reanudar", pt "Continuar", en "Play").
- `scripts/fetch-player-photo.mjs <usuario>`: baja `https://unavatar.io/x/<usuario>` y lo guarda como `src/assets/players/<usuario en minúsculas>.jpg`; falla con mensaje claro si la respuesta no es una imagen. Usarlo para las 11 fotos.

Diseño: franja de la maqueta `reviews-y-franja.html` (sección "Franja de jugadores"): superficie oscura con bordes finos arriba y abajo, etiqueta en dorado y mayúsculas, chips con foto redonda de 34 px y nombre, máscara de desvanecido en los bordes. Sin foto: círculo `bg-beam` con la inicial. Lista semántica (`<ul>`) con el nombre accesible del `label`.

- [ ] **Step 1: Tests que fallan**
```ts
// tests/unit/content.test.ts
test("players match the approved list and order", () =>
  expect(PLAYERS.map((p) => [p.name, p.handle])).toEqual([
    ["K1ng","k1ng"],["Fazer","fazerfn"],["Phzin","Phzinfps1"],["Randu","randuimmm"],["Lewa","LewaFn"],
    ["Romero","romerofdps"],["Edson","edsonmalado"],["Tisco","Tiscofn"],["Diguera","loud_diguera"],
    ["Mack","mackftn"],["Vadeal","VadealFN"],
  ]));
test("every player has a photo", () => expect(PLAYERS.every((p) => p.photo)).toBe(true));
```
```ts
// tests/e2e/players-strip.spec.ts
test("strip sits right after the hero with the worked-with label", …)
  // /es: la sección siguiente al hero tiene nombre accesible "Trabajé con"; /pt "Trabalhei com"; /en "Worked with"
test("screen readers get each player once", …)
  // getByRole("listitem") dentro de la franja (árbol de accesibilidad) → 11 nombres en el orden de PLAYERS
test("loop copies are hidden and not focusable", …)
  // la copia tiene aria-hidden="true" e inert; Tab no entra en ella
test("pause button stops the motion and is easy to tap", …)
  // botón "Pausar" ≥44×44; tras clic, aria-pressed="true", texto "Reanudar" y la posición de la fila no cambia en 500 ms
test("hover and keyboard focus pause the motion", …)
test("reduced motion keeps the strip still", …)
  // emulateMedia({ reducedMotion: "reduce" }) → animation-name "none" y la fila no se mueve en 500 ms
```

- [ ] **Step 2: Correr y ver que fallan.**
- [ ] **Step 3: Implementar** el script, bajar las 11 fotos, `players.ts`, `MarqueeGroup`/`MarqueeRow` y la franja.
- [ ] **Step 4: Correr y ver que pasa** — `npm run test && npx playwright test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `feat: franja "Trabajé con" con los jugadores y componentes de movimiento con pausa`.

---

### Task 4: Datos de los tweets

**Files:**
- Create: `src/content/tweets.ts`, `src/lib/tweets.ts`, `tests/fixtures/tweets/<id>.json` (10)
- Modify: `package.json` (dependencia `react-tweet@^3.3.1`)
- Test: `tests/unit/tweets.test.ts`

**Interfaces:**
- Produces:
  - `TWEET_IDS: readonly string[]` con los 10 IDs del spec.
  - `type TweetCard = { id: string; url: string; author: { name: string; handle: string; avatarUrl: string }; text: string; createdAt: string; image?: { url: string; width: number; height: number } }` — `url` = `https://x.com/<handle>/status/<id>`; `text` sin el link `t.co` final y con entidades HTML decodificadas; `image` = primera foto del tweet.
  - `toTweetCard(tweet: Tweet): TweetCard` (tipo `Tweet` de `react-tweet/api`), pura.
  - `tweetTextParts(text: string): Array<{ kind: "text" | "mention" | "self"; value: string }>` — `self` para `@tallami1` sin importar mayúsculas, `mention` para el resto de `@usuario`.
  - `fetchTweetCards(ids: readonly string[], load: (id: string) => Promise<Tweet | undefined>): Promise<TweetCard[]>` — omite los que devuelven `undefined` o tiran error; ordena del más nuevo al más viejo.
  - `getTweetCards(ids: readonly string[]): Promise<TweetCard[]>` — `"use cache"` + `cacheLife("days")`; usa `getTweet` de `react-tweet/api`, salvo que exista `process.env.TWEETS_FIXTURE_DIR`: entonces lee `<dir>/<id>.json`.
- Fixtures: grabar la respuesta real de `getTweet` para cada uno de los 10 IDs (un script de una vez o un test manual; no se commitea el script si no hace falta).

- [ ] **Step 1: Tests que fallan** (`tests/unit/tweets.test.ts`, usando los fixtures)
```ts
test("maps a recorded tweet to a card", …)
  // fixture 1964780083618685407 → author.handle "Tiscofn", url "https://x.com/Tiscofn/status/1964780083618685407",
  // text "12th FNCS Globals ($30.000)🇦🇷\n\n@CaduFN1 @StrykerFN1 @tallami1" (sin t.co), image con width/height > 0
test("decodes html entities and never returns markup", …)
  // toTweetCard({...fixture, text: "Q&amp;A &lt;3 https://t.co/abc"}).text === "Q&A <3"
test("splits mentions and highlights the coach", …)
  // tweetTextParts("1st @romerofdps @Tallami1 gg") → [text "1st ", mention "@romerofdps", text " ", self "@Tallami1", text " gg"]
test("skips tweets that fail or no longer exist and sorts newest first", …)
  // fetchTweetCards(["a","b","c"], load) donde "a" tira error, "b" → undefined, "c" → fixture → 1 card
  // con los 10 fixtures → primero 2104290558906868129, último 1891289855725887688
test("returns an empty list when every tweet fails", …)
```
- [ ] **Step 2: Correr y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr y ver que pasa** — `npm run test && npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** — `feat: datos de tweets desde X con caché diaria y respuestas grabadas para tests`.

---

### Task 5: Sección "Reviews" con el muro en movimiento

**Files:**
- Create: `src/components/home/tweet-card.tsx`, `src/components/home/tweet-card.module.css`, `src/components/home/reviews-wall.tsx`, `src/components/home/reviews-wall.module.css`
- Modify: `src/app/[locale]/page.tsx` (entre `<ResultsBoard />` y `<ServicesMenu />`), `src/components/home/site-header.tsx` (link "Reviews" a `#reviews` entre Resultados y Servicios, solo si hay tarjetas), `next.config.ts` (`images.remotePatterns` para `https://pbs.twimg.com/**`), `playwright.config.ts` (`webServer.env.TWEETS_FIXTURE_DIR = "tests/fixtures/tweets"`), `messages/{es,pt,en}.json` (`Reviews`, `Header.reviews`)
- Test: `tests/e2e/reviews.spec.ts`

**Interfaces:**
- Consumes: `getTweetCards`, `tweetTextParts`, `TWEET_IDS` (Tarea 4); `MarqueeGroup`, `MarqueeRow` (Tarea 3).
- Mensajes `Reviews`: `title` "Reviews" (los tres), `lede` es "Tweets de mis jugadores con su puesto y lo que ganaron. Tocá cualquiera para verlo en X.", `viewOnX` es "Ver en X", `cardLabel` es "Tweet de {name} en X" (nombre accesible del link), `pause`/`resume` como en `Players`. `Header.reviews` "Reviews".

Diseño: opción C de `reviews-y-franja.html`. Sección `id="reviews"` sobre superficie oscura con `h2` y bajada; dos `MarqueeRow` en sentidos opuestos dentro de un `MarqueeGroup` (un solo botón de pausa), tarjetas repartidas alternando (índices pares arriba, impares abajo) en orden de `getTweetCards`. Tarjeta: link `target="_blank" rel="noopener noreferrer"` a `card.url`; foto de perfil (`next/image`, 40 px, redonda), nombre, @usuario, marca "𝕏" decorativa (`aria-hidden`), texto con `tweetTextParts` (`self` en dorado y negrita, `mention` en azul claro, saltos de línea respetados, fuente de emojis del sistema como respaldo), imagen 16:9 con `next/image` en `loading="lazy"` y `alt=""`, pie con fecha localizada (`Intl.DateTimeFormat` del idioma) y "Ver en X →". Borde dorado al hover y al foco. Ancho de tarjeta ~250 px.

- [ ] **Step 1: Tests que fallan** (`tests/e2e/reviews.spec.ts`, build con fixtures)
```ts
test("reviews sit between results and services with the nav link", …)
  // /es: #results < #reviews < #services en el DOM; h2 "Reviews"; link de la nav "Reviews" → "#reviews"
test("each tweet appears once for screen readers and links to X", …)
  // links con nombre "Tweet de … en X" visibles al árbol de accesibilidad → 10; cada href coincide con
  // /^https:\/\/x\.com\/\w+\/status\/\d+$/ y está entre los 10 IDs; target "_blank"; rel contiene "noopener"
test("newest tweet comes first", …)  // primera tarjeta de la fila de arriba → status/2104290558906868129
test("coach mention is highlighted in gold", …)  // un elemento con texto "@tallami1" tiene color rgb(255, 201, 60)
test("loop copies are hidden and not focusable", …)
test("pause button stops both rows", …)  // ≥44×44, aria-pressed, ninguna fila se mueve en 500 ms
test("keyboard focus pauses the wall and shows the whole card", …)
  // Tab hasta una tarjeta del muro → ninguna fila se mueve; la caja de la tarjeta enfocada está dentro de la caja visible de su fila
test("reduced motion keeps the wall still and scrollable", …)
```
- [ ] **Step 2: Correr y ver que fallan.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr y ver que pasa** — `npm run test && npx playwright test && npm run lint && npm run typecheck`; `next build` sin warnings.
- [ ] **Step 5: Commit** — `feat: sección Reviews con muro de tweets en movimiento`.

---

### Task 6: Verificación de calidad y rendimiento

**Files:**
- Modify: lo que haga falta para pasar las verificaciones (componentes de las Tareas 1–5)
- Test: `tests/e2e/quality.spec.ts` (existente: scroll horizontal en 5 anchos × 3 idiomas y axe a 375/1440)

- [ ] **Step 1:** Correr `npx playwright test tests/e2e/quality.spec.ts`. Confirmar que cubre la franja y el muro (página completa). Arreglar en los componentes lo que falle.
- [ ] **Step 2:** Medir Lighthouse en modo celular sobre `/es` del build de producción (`npm run build && npm run start`, con red real para los tweets): LCP < 2,5 s, TBT < 200 ms, CLS < 0,1. Usar `npx lighthouse@<versión fija> http://localhost:<puerto>/es --form-factor=mobile --only-categories=performance,accessibility --output=json` con el Chromium de Playwright (`CHROME_PATH`). Guardar el resumen (no el JSON completo) en el reporte. Si algo no cumple, arreglarlo.
- [ ] **Step 3:** Suite completa: `npm run lint && npm run typecheck && npm run test && npm run test:e2e`.
- [ ] **Step 4: Commit** de los arreglos (si hubo) — `fix: …` o `perf: …`.
