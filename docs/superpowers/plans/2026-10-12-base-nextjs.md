# Base Next.js con la home de la propuesta C — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar andando en la raíz del repo un sitio Next.js en `/es`, `/pt` y `/en` cuya home reproduce la propuesta C, con tests y build en verde.

**Architecture:** App Router con `app/[locale]` como layout raíz y next-intl 4 leyendo el idioma con `next/root-params` (sin `setRequestLocale`). Los datos que no se traducen (resultados, precios, redes) viven en `src/content/*.ts`; los textos, en `messages/{es,pt,en}.json`. Cada sección de la home es un componente de servidor en `src/components/home/`, con Tailwind para layout y color y un CSS Module al lado solo para lo que las utilidades no expresan bien.

**Tech Stack:** Next.js 16.4 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (base radix) · next-intl 4.14 · Vitest · Playwright + @axe-core/playwright · npm.

**Spec:** No hay documento de diseño aparte; el spec es la suma de:
- `propuestas/c-analisis.html`: diseño, tokens, estructura y todo el texto en español.
- `propuestas/README.md`: decisiones de la revisión (coach freelance, unidades de precio, FAQ, aviso de Epic).
- `CLAUDE.md`: precios, palmarés, idiomas y stack.

## Global Constraints

- Next.js en la raíz del repo; `propuestas/`, `assets/`, `.claude/` y `docs/` quedan como están y fuera de TypeScript y ESLint.
- Rutas con prefijo siempre: `/es`, `/pt`, `/en`. Idioma por defecto `es`. `lang` del `<html>`: `es`, `pt-BR`, `en`.
- Textos en español copiados literalmente de `propuestas/c-analisis.html`. Español con voseo rioplatense ("Entrená", "Pagás"). Portugués de Brasil con "você"; dúo o trío = "dupla ou trio"; en inglés, "duo or trio". No se traducen nombres de torneos, temporadas, jugadores, "Academia Tallami", "Temporada Pro" ni "Tallami".
- Nunca inventar resultados, testimonios ni reseñas. Todo resultado sale de `src/content/results.ts`, que copia el `CLAUDE.md`.
- Ningún precio escrito en los JSON de mensajes: siempre llega como argumento ICU desde `src/content/services.ts`.
- Pie en los tres idiomas con el aviso: es "No afiliado ni respaldado por Epic Games.", pt "Não afiliado nem endossado pela Epic Games.", en "Not affiliated with or endorsed by Epic Games."
- Sin logos ni imágenes del juego.
- Tokens de color (de `c-analisis.html` líneas 13–31): stage `#0B1433`, stage-2 `#13214F`, beam `#3D5BDB`, gold `#FFC93C` (hover `#FFD766`), on-stage `#F3F5FA`, on-stage-2 `#AEB8D6`, stage-line `rgb(174 184 214 / .22)`, paper `#EEF1EC`, ink `#17202A`, ink-2 `#4A5563`, rule `#C9D0C6`, zone `#2457C5`. Radio 4px. Ancho máximo 1180px; gutter `clamp(16px, 4vw, 40px)`.
- Tipografía única: Saira con eje `wdth` vía `next/font/google`, variable `--font-saira`.
- Sin modo oscuro conmutable: el diseño alterna superficies fijas (escenario oscuro y pizarra clara).
- Git: rama `feat/base-nextjs`. Agregar archivos **por ruta explícita**; nunca `git add -A` ni `git add .`. Nunca agregar `.claude/settings.json`, `.mcp.json`, `propuestas/` ni `instalar-kit.bat` (tienen cambios locales que el usuario todavía no decidió). Commits en formato `feat: …`, `test: …`, `chore: …`, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Imágenes con `next/image` y prop `preload` (no `priority`, deprecada en Next 16).

## Review Focus

1. **Visitante en `/` con el navegador en otro idioma:** `pt-BR` debe caer en `/pt`; `es-MX` y cualquier idioma no soportado (`fr`), en `/es`; `en-US`, en `/en`. → test en la Tarea 1.
2. **Celular de 320 px con el texto más largo (portugués):** sin scroll horizontal y con la tabla de resultados apilada y legible. → test en la Tarea 5, en los tres idiomas.
3. **Link roto o idioma inexistente (`/es/no-existe`, `/fr`):** 404 con la página "no encontrada" en el idioma correspondiente y un link a la home, nunca una pantalla en blanco. → test en la Tarea 1.
4. **Clave faltante en `pt.json` o `en.json`:** se vería la clave cruda en la página. Los tres archivos deben tener exactamente las mismas claves. → test unitario en la Tarea 1, que vale para todas las tareas siguientes.
5. **Usuario con teclado:** el link "Saltar al contenido" es lo primero que se enfoca, el foco se ve y las preguntas frecuentes se abren con Enter. → tests en las Tareas 4 y 5.

---

## Estructura de archivos

```
messages/es.json, pt.json, en.json        textos por idioma
src/proxy.ts                              middleware de next-intl
src/i18n/routing.ts                       locales, Locale, HTML_LANG, INTL_TAG
src/i18n/request.ts                       getRequestConfig con root params
src/i18n/navigation.ts                    Link, usePathname, getPathname
src/app/globals.css                       Tailwind, @theme con tokens, variables de shadcn
src/app/[locale]/layout.tsx               layout raíz: <html lang>, fuente, provider, metadata
src/app/[locale]/page.tsx                 compone las secciones
src/app/[locale]/not-found.tsx            404 localizado
src/app/[locale]/[...rest]/page.tsx       llama a notFound()
src/app/sitemap.ts, src/app/robots.ts
src/lib/utils.ts                          cn (shadcn)
src/lib/format.ts                         formatUsd, formatPlace, formatList
src/lib/site-url.ts                       SITE_URL
src/content/results.ts                    WINS, OTHER_RESULTS, earnings, contadores
src/content/services.ts                   SERVICES, LESSON_PACK, PRO_SEASON, bookingHref
src/content/social.ts                     SOCIAL_LINKS
src/assets/tallami-wide-1920.jpg          foto de portada (copiada de propuestas/img)
src/components/ui/button.tsx              Button de shadcn con variantes propias
src/components/home/site-header.tsx, locale-switcher.tsx, hero.tsx(+ .module.css),
  results-board.tsx(+ .module.css), services-menu.tsx(+ .module.css),
  how-it-works.tsx(+ .module.css), faq.tsx(+ .module.css), site-footer.tsx
tests/unit/*.test.ts                      Vitest
tests/e2e/*.spec.ts                       Playwright
```

---

### Task 1: Proyecto, idiomas y página 404

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json`, `vitest.config.ts`, `playwright.config.ts`, `README.md`
- Create: `src/proxy.ts`, `src/i18n/{routing,request,navigation}.ts`, `src/app/globals.css`, `src/app/[locale]/{layout,page,not-found}.tsx`, `src/app/[locale]/[...rest]/page.tsx`, `src/lib/utils.ts`, `src/components/ui/button.tsx`
- Create: `messages/{es,pt,en}.json`
- Modify: `.gitignore` (sumar `/test-results/`, `/playwright-report/`, `/coverage/`, `next-env.d.ts`, `*.tsbuildinfo`)
- Test: `tests/unit/messages.test.ts`, `tests/e2e/i18n-routing.spec.ts`

**Interfaces:**
- Produces:
  - `routing` (`defineRouting({ locales: ['es','pt','en'], defaultLocale: 'es', localePrefix: 'always' })`), `type Locale = 'es' | 'pt' | 'en'`, `HTML_LANG: Record<Locale, string>` (`es`, `pt-BR`, `en`), `INTL_TAG: Record<Locale, string>` (`es-AR`, `pt-BR`, `en-US`). Todo en `src/i18n/routing.ts`.
  - `Link`, `usePathname`, `getPathname` desde `src/i18n/navigation.ts`.
  - `Button` en `src/components/ui/button.tsx`, con `variant: 'gold' | 'stage-outline' | 'ink-outline'`, `size: 'default' | 'sm'` y `asChild`. Default: `min-h-12 px-[22px] font-bold rounded-[4px]`; `sm`: `min-h-11 px-4 text-[.95rem]`. Colores de `c-analisis.html` líneas 53–62 (`gold` = `.btn-gold`, `stage-outline` = `.btn-ghost`, `ink-outline` = `.btn-line`).
  - Clases de Tailwind para los tokens (`bg-stage`, `text-on-stage-2`, `border-stage-line`, `bg-paper`, `text-ink-2`, `text-zone`, `text-gold`, etc.) y `font-sans` = Saira, definidas en `@theme` de `globals.css`.
  - Namespaces de mensajes creados acá: `Metadata` (`title`, `description`), `Common` (`skipLink`), `NotFound` (`title`, `body`, `back`).

- [ ] **Step 1: Crear la rama y el proyecto**

```bash
git switch -c feat/base-nextjs
```
Generar con `npx create-next-app@16.4.0` (TypeScript, Tailwind, ESLint, App Router, `src/`, alias `@/*`, npm) en una carpeta vacía del scratchpad y mover el resultado a la raíz sin `.git` ni `README.md`; fusionar su `.gitignore` con el existente. Borrar los SVG de ejemplo de `public/` y el contenido demo de `src/app/page.tsx`. Después: `npm i next-intl@4`, `npm i -D vitest @playwright/test @axe-core/playwright`, `npx shadcn@4.21.4 init -d -b radix --no-monorepo` y `npx shadcn@4.21.4 add button`. En `tsconfig.json` y `eslint.config.mjs`, excluir `propuestas/`, `.claude/` y `docs/`. Scripts: `dev`, `build`, `start`, `lint` (`eslint .`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:e2e` (`playwright test`).

- [ ] **Step 2: Escribir los tests que fallan**

`tests/unit/messages.test.ts`:
```ts
test('pt and en define exactly the same message keys as es', () => {
  expect(flattenKeys(pt)).toEqual(flattenKeys(es));
  expect(flattenKeys(en)).toEqual(flattenKeys(es));
});
test('no message is empty', () => { /* todo valor hoja es string con trim().length > 0 en los 3 archivos */ });
```
(`flattenKeys` es un helper local del test que devuelve las rutas `a.b.c` ordenadas.)

`tests/e2e/i18n-routing.spec.ts`, con `test.use({ locale })` para fijar `Accept-Language`:
```ts
for (const [browserLocale, path] of [['pt-BR','/pt'],['es-MX','/es'],['en-US','/en'],['fr-FR','/es']])
  test(`root redirects ${browserLocale} visitors to ${path}`, …)  // expect(page).toHaveURL(new RegExp(`${path}$`))
test('html lang matches the locale', …)  // /es → "es", /pt → "pt-BR", /en → "en"
test('unknown path shows the localized 404', …)
  // /es/no-existe → status 404, heading "No encontramos esta página", link a /es
  // /pt/nao-existe → "Não encontramos esta página"; /en/missing → "We couldn't find this page"
test('unsupported locale prefix ends in the Spanish 404', …)  // /fr → status 404, heading en español
```

- [ ] **Step 3: Correr los tests y ver que fallan**

Run: `npx vitest run tests/unit/messages.test.ts` → FAIL (no existen los JSON).
Run: `npx playwright test tests/e2e/i18n-routing.spec.ts` → FAIL.
`playwright.config.ts`: solo Chromium; `webServer` = `npm run build && npm run start -- --port 3100`, `url: http://localhost:3100`, `reuseExistingServer: !process.env.CI`, `timeout: 180_000`; `baseURL` igual. Si falta el navegador: `npx playwright install chromium`. `vitest.config.ts`: entorno `node`, `include: ['tests/unit/**/*.test.ts']`, alias `@` → `./src`.

- [ ] **Step 4: Implementar idiomas, layout y 404**

- `src/i18n/request.ts` sigue la doc actual de next-intl 4.14 con `next/root-params` (si llega `locale` lo usa; si no, `rootParams.locale()`; si no es válido, `notFound()`) y carga `messages/${locale}.json`. `next.config.ts` envuelto con `createNextIntlPlugin()`.
- `src/proxy.ts` = `createMiddleware(routing)` con el matcher de la doc (`'/((?!api|trpc|_next|_vercel|.*\\..*).*)'`).
- `layout.tsx`: `generateStaticParams` con los 3 locales; `<html lang={HTML_LANG[locale]}>`; Saira vía `next/font/google` (`axes: ['wdth']`, `subsets: ['latin']`, `variable: '--font-saira'`, `display: 'swap'`); `NextIntlClientProvider`; link "Saltar al contenido" (`#contenido`) como primer hijo del `<body>`, oculto hasta recibir foco (estilo `.skip` de las líneas 43–44). `generateMetadata` mínimo con `Metadata.title` y `Metadata.description` (se completa en la Tarea 5).
- `globals.css`: `@theme` con los tokens de Global Constraints. Las variables de shadcn apuntan a la paleta (`--background` paper, `--foreground` ink, `--ring` zone, `--primary` gold, `--primary-foreground` stage, `--border` rule); se borra el bloque `.dark`. Base: `body` en paper/ink, `font-size: 1.0625rem`, `line-height: 1.55`; `:focus-visible` con `outline: 3px solid var(--color-zone)` y `outline-offset: 3px`; `h1, h2, h3 { text-wrap: balance }`; `scroll-behavior: smooth` solo con `prefers-reduced-motion: no-preference`.
- `page.tsx` provisorio: `<main id="contenido">` con un `<h1>` de `Metadata.title`. La Tarea 3 lo reemplaza.
- `not-found.tsx` con `NotFound.*` y `[...rest]/page.tsx` que llama a `notFound()`.
- Mensajes. es: `Metadata.title` "Tallami Coaching · Coaching de Fortnite competitivo"; `Metadata.description` = `c-analisis.html` línea 7; `NotFound.title` "No encontramos esta página", `body` "Puede que el link esté mal o que la página ya no exista.", `back` "Volver al inicio". pt y en, traducidos con los títulos de 404 del Step 2.
- `button.tsx`: reemplazar las variantes generadas por las de la sección Interfaces.
- `README.md` corto en español: requisitos (Node 20+), `npm install`, `npm run dev`, y los comandos de test.

- [ ] **Step 5: Correr y ver que pasa**

Run: `npm run test && npm run test:e2e && npm run lint && npm run typecheck`
Expected: todo en verde.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.ts tsconfig.json eslint.config.mjs postcss.config.mjs components.json vitest.config.ts playwright.config.ts README.md .gitignore src messages tests public
git commit -m "feat: base Next.js con next-intl (es, pt, en) y 404 localizado"
```

---

### Task 2: Datos de contenido y formato por idioma

**Files:**
- Create: `src/lib/format.ts`, `src/content/results.ts`, `src/content/services.ts`, `src/content/social.ts`, `src/assets/tallami-wide-1920.jpg` (copia de `propuestas/img/tallami-wide-1920.jpg`)
- Test: `tests/unit/format.test.ts`, `tests/unit/content.test.ts`

**Interfaces:**
- Consumes: `Locale`, `INTL_TAG` (Tarea 1).
- Produces:
  - `formatUsd(amount: number, locale: Locale): string`: `"USD "` + número agrupado con `Intl.NumberFormat(INTL_TAG[locale], { maximumFractionDigits: 0 })`, con espacio normal.
  - `formatPlace(place: number, locale: Locale): string`: es y pt `${n}º` (U+00BA); en, ordinal con `Intl.PluralRules('en-US', { type: 'ordinal' })` (st, nd, rd, th).
  - `formatList(items: readonly string[], locale: Locale): string`: `Intl.ListFormat(INTL_TAG[locale], { type: 'conjunction' })`.
  - `type Win = { event: 'FNCS' | 'Reload Elite' | 'Second Chance'; season?: string; players: readonly string[] }`, `WINS: readonly Win[]`.
  - `type OtherResult = { place: number; event: 'EWC Reload' | 'EWC ESL' | 'Globals'; season?: string }`, `OTHER_RESULTS: readonly OtherResult[]`.
  - `COACHING_EARNINGS_USD = 45300`, `EARNINGS_SINCE = 'CH5S4'`, `FNCS_TITLES` (= cantidad de `WINS` con event `'FNCS'`), `FIRST_PLACES` (= `WINS.length`).
  - `type ServiceId = 'vodRecorded' | 'vodLive' | 'lesson' | 'gamePlan' | 'tournament' | 'academy'`, `type PriceUnit = 'perTeam' | 'perMonth'`, `type Service = { id: ServiceId; priceUsd: number; unit?: PriceUnit }`, `SERVICES: readonly Service[]`.
  - `LESSON_PACK = { sessions: 4, priceUsd: 140 }`, `lessonPackSavingsUsd(): number`, `PRO_SEASON = { priceUsd: 200, prizeSharePercent: 6 }`.
  - `bookingHref(id: ServiceId | 'proSeason'): string`: hoy devuelve `'#services'` en todos los casos (el pago y la agenda llegan en la fase de pagos; es el único lugar a cambiar).
  - `SOCIAL_LINKS: readonly { label: 'X' | 'Twitch' | 'YouTube' | 'Instagram' | 'TikTok'; href: string }[]` con las URLs del `CLAUDE.md`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/unit/format.test.ts`:
```ts
test('formatUsd groups thousands per locale', () => {
  expect(formatUsd(45300, 'es')).toBe('USD 45.300');
  expect(formatUsd(45300, 'pt')).toBe('USD 45.300');
  expect(formatUsd(45300, 'en')).toBe('USD 45,300');
  expect(formatUsd(30, 'es')).toBe('USD 30');
});
test('formatPlace uses º in es and pt and English ordinals in en', () => {
  expect(formatPlace(1, 'es')).toBe('1º'); expect(formatPlace(22, 'pt')).toBe('22º');
  expect([1, 5, 9, 11, 12, 14, 22].map((n) => formatPlace(n, 'en')))
    .toEqual(['1st', '5th', '9th', '11th', '12th', '14th', '22nd']);
});
test('formatList joins players with the locale conjunction', () => {
  const p = ['K1ng', 'Fazer', 'Phzin'];
  expect(formatList(p, 'es')).toBe('K1ng, Fazer y Phzin');
  expect(formatList(p, 'pt')).toBe('K1ng, Fazer e Phzin');
  expect(formatList(p, 'en')).toBe('K1ng, Fazer, and Phzin');
  expect(formatList(['Randu', 'Lewa'], 'es')).toBe('Randu y Lewa');
});
```

`tests/unit/content.test.ts` (valores del `CLAUDE.md`):
```ts
test('wins match CLAUDE.md in display order', () => expect(WINS).toEqual([
  { event: 'FNCS', season: 'CH6S1', players: ['K1ng', 'Fazer', 'Phzin'] },
  { event: 'FNCS', season: 'CH5S3', players: ['K1ng', 'Fazer'] },
  { event: 'FNCS', season: 'CH5S2', players: ['Randu', 'Lewa'] },
  { event: 'Reload Elite', players: ['Phzin', 'Edson'] },
  { event: 'Reload Elite', players: ['Romero', 'Lewa'] },
  { event: 'Second Chance', players: ['K1ng', 'Fazer'] },
]));
test('hero counters derive from wins', () => { expect(FNCS_TITLES).toBe(3); expect(FIRST_PLACES).toBe(6); });
test('other results match CLAUDE.md', () => expect(OTHER_RESULTS).toEqual([
  { place: 5, event: 'EWC Reload' }, { place: 9, event: 'EWC ESL' },
  { place: 11, event: 'Globals', season: '2025' }, { place: 12, event: 'Globals', season: '2025' },
  { place: 14, event: 'Globals', season: '2026' }, { place: 22, event: 'Globals', season: '2024' },
]));
test('earnings', () => { expect(COACHING_EARNINGS_USD).toBe(45300); expect(EARNINGS_SINCE).toBe('CH5S4'); });
test('service prices match CLAUDE.md', () => expect(SERVICES).toEqual([
  { id: 'vodRecorded', priceUsd: 30 }, { id: 'vodLive', priceUsd: 45 }, { id: 'lesson', priceUsd: 40 },
  { id: 'gamePlan', priceUsd: 120 }, { id: 'tournament', priceUsd: 150, unit: 'perTeam' },
  { id: 'academy', priceUsd: 15, unit: 'perMonth' },
]));
test('lesson pack and pro season', () => {
  expect(LESSON_PACK).toEqual({ sessions: 4, priceUsd: 140 }); expect(lessonPackSavingsUsd()).toBe(20);
  expect(PRO_SEASON).toEqual({ priceUsd: 200, prizeSharePercent: 6 });
});
test('social links', () => expect(SOCIAL_LINKS.map((l) => l.href)).toEqual([
  'https://x.com/tallami1', 'https://twitch.tv/tallami', 'https://youtube.com/@tallami1',
  'https://instagram.com/tallami1', 'https://tiktok.com/@tallami',
]));
```

- [ ] **Step 2: Correr y ver que fallan** — Run: `npx vitest run tests/unit/format.test.ts tests/unit/content.test.ts` → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar** los módulos con las firmas de Interfaces. Copiar la foto a `src/assets/`.

- [ ] **Step 4: Correr y ver que pasa** — Run: `npm run test && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/content src/assets tests/unit/format.test.ts tests/unit/content.test.ts
git commit -m "feat: datos de resultados, servicios y redes con formato por idioma"
```

---

### Task 3: Encabezado, portada y resultados (superficie de escenario)

**Files:**
- Create: `src/components/home/{site-header,locale-switcher,hero,results-board}.tsx`, `hero.module.css`, `results-board.module.css`
- Modify: `src/app/[locale]/page.tsx`, `messages/{es,pt,en}.json` (namespaces `Header`, `Hero`, `Results`)
- Test: `tests/e2e/home-stage.spec.ts`

**Interfaces:**
- Consumes: `Button`, `Link`, `usePathname`, `formatUsd`, `formatPlace`, `formatList`, `WINS`, `OTHER_RESULTS`, `COACHING_EARNINGS_USD`, `EARNINGS_SINCE`, `FNCS_TITLES`, `FIRST_PLACES`.
- Produces: secciones con IDs estables en todos los idiomas: `results`, `services`, `how-it-works`, `faq` (las Tareas 4 y 5 los usan para las anclas). `page.tsx` renderiza `<SiteHeader/>` y `<main id="contenido">` con `<Hero/>` y `<ResultsBoard/>`.

Referencia de diseño, estructura y copy en español: `c-analisis.html`, líneas 64–121 y 171–205 (CSS) y 211–280 (HTML). Igual que en la propuesta: encabezado absoluto sobre la portada; en móvil, la navegación pasa a una fila con scroll horizontal y máscara; marcador con los contadores; título; bajada; dos botones; zócalo de nombre con animación de barrido solo con `prefers-reduced-motion: no-preference`; tabla de 6 primeros puestos que en ≤640 px se apila en grilla; lista "Otros resultados"; caja de ganancias. La foto es `<Image fill preload sizes="100vw">` con el `object-position` y el degradado de la propuesta para cada ancho. El texto alternativo de la foto va en mensajes (`Hero.imageAlt`).

Copy fijado (el resto se traduce siguiendo las Global Constraints):
- `Hero.title` (ICU con `{count}` = `FNCS_TITLES`): es "Entrená con el coach detrás de {count} títulos de FNCS" · pt "Treine com o coach por trás de {count} títulos da FNCS" · en "Train with the coach behind {count} FNCS titles".
- `Results.earnings` (ICU con `{since}`): es "en ganancias de coaching registradas desde {since}".
- Selector de idioma: `<nav aria-label>` con `Header.languageLabel` (es "Idioma"); links "ES", "PT", "EN" con `lang` y `hrefLang`, el actual con `aria-current="page"`; cada uno lleva a la misma ruta en el otro idioma.

- [ ] **Step 1: Escribir los tests que fallan** (`tests/e2e/home-stage.spec.ts`)

```ts
test('hero headline is localized', …)
  // h1: /es → "Entrená con el coach detrás de 3 títulos de FNCS"; /pt y /en → los textos de arriba con 3
test('hero counters show FNCS titles and first places', …)
  // en /es, el grupo "Resumen de resultados como coach" contiene "3" + "títulos de FNCS" y "6" + "primeros puestos"
test('results board lists six first places with players joined per locale', …)
  // #results table tbody tr → count 6; primera fila contiene "1º", "FNCS", "CH6S1", "K1ng, Fazer y Phzin"
  // /pt primera fila "K1ng, Fazer e Phzin"; /en primera fila "1st" y "K1ng, Fazer, and Phzin"
test('other results and earnings are formatted per locale', …)
  // /es: lista con 6 ítems, contiene "22º" y "Globals"; earnings "USD 45.300"; /en: "22nd" y "USD 45,300"
test('language switcher moves to the same page in the chosen language', …)
  // /es → click link "PT" dentro de nav "Idioma" → URL termina en /pt, h1 en portugués,
  // y el link PT tiene aria-current="page"
test('main navigation anchors point to the home sections', …)
  // links de la nav principal con href "#results", "#services", "#how-it-works", "#faq"
test('lower-third animation is disabled with reduced motion', …)
  // page.emulateMedia({ reducedMotion: 'reduce' }) → animation-name computado del nombre = "none"
```

- [ ] **Step 2: Correr y ver que fallan** — Run: `npx playwright test tests/e2e/home-stage.spec.ts` → FAIL.

- [ ] **Step 3: Implementar** las secciones y los mensajes en los tres idiomas. `locale-switcher.tsx` es el único componente de cliente (`'use client'`, usa `usePathname`). Las anclas `#services`, `#how-it-works` y `#faq` todavía no tienen destino; la Tarea 4 los crea.

- [ ] **Step 4: Correr y ver que pasa** — Run: `npm run test && npx playwright test && npm run lint && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/home src/app messages tests/e2e/home-stage.spec.ts
git commit -m "feat: encabezado, portada y tabla de resultados de la home"
```

---

### Task 4: Servicios, cómo funciona, preguntas y pie (superficie de pizarra)

**Files:**
- Create: `src/components/home/{services-menu,how-it-works,faq,site-footer}.tsx`, `services-menu.module.css`, `how-it-works.module.css`, `faq.module.css`
- Modify: `src/app/[locale]/page.tsx`, `messages/{es,pt,en}.json` (namespaces `Services`, `HowItWorks`, `Faq`, `Footer`)
- Test: `tests/e2e/home-paper.spec.ts`

**Interfaces:**
- Consumes: `SERVICES`, `LESSON_PACK`, `lessonPackSavingsUsd`, `PRO_SEASON`, `bookingHref`, `SOCIAL_LINKS`, `formatUsd`, `Button`, IDs de sección de la Tarea 3.
- Produces: cada precio se renderiza en un elemento con `data-testid="price"`; la Temporada Pro va última.

Referencia: `c-analisis.html`, líneas 123–169 y 179–205 (CSS) y 282–381 (HTML). Igual que en la propuesta: fondo de puntos y bordes superiores; columna de introducción pegajosa en escritorio; menú con línea punteada entre nombre y precio; unidades debajo del precio; tarjeta oscura de Temporada Pro; ruta de 4 pasos con línea discontinua (en 2 columnas en ≤900 px y en 1 en ≤640 px); FAQ con `<details>/<summary>` nativos y el "+" que gira; pie oscuro con marca, redes y aviso.

Mensajes con argumentos (nunca precios literales):
- `Services.items.<ServiceId>.{name, description, cta}`; `lesson.description` recibe `{sessions}`, `{packPrice}` y `{savings}` ya formateados (es: "60 minutos sobre lo que más te cuesta. Pack de {sessions} clases: {packPrice}, ahorrás {savings}.").
- `Services.units.{perTeam, perMonth}`; `Services.pro.unit` recibe `{percent}` (es: "por jugador + {percent}% de premios").
- `Faq.items.pro.answer` recibe `{price}` y `{percent}`.

- [ ] **Step 1: Escribir los tests que fallan** (`tests/e2e/home-paper.spec.ts`)

```ts
test('services show every CLAUDE.md price in order', …)
  // /es: #services [data-testid=price] → textos que empiezan con
  // ["USD 30","USD 45","USD 40","USD 120","USD 150","USD 15","USD 200"]
test('price units and lesson pack are shown', …)
  // /es #services contiene "por dúo o trío", "por mes", "por jugador + 6% de premios",
  // "Pack de 4 clases: USD 140, ahorrás USD 20."
test('minors note sits next to prices', …)  // /es #services contiene "¿Tenés menos de 18 años?"
test('booking links stay inside the services section until payments exist', …)
  // cada link "Reservar…" / "Pedir mi plan" / "Unirme a la Academia" / "Aplicar a Temporada Pro" tiene href que termina en "#services"
test('how it works has four steps', …)  // #how-it-works ol > li → count 4
test('faq answers open with the keyboard', …)
  // /es: foco en summary "¿Puedo entrenar si tengo menos de 18 años?", Enter →
  // "Sí. El pago lo hace un adulto responsable, y la sesión es con vos." visible
test('footer shows social links and the Epic disclaimer per locale', …)
  // 5 links con los href de SOCIAL_LINKS; /es "No afiliado ni respaldado por Epic Games.",
  // /pt "Não afiliado nem endossado pela Epic Games.", /en "Not affiliated with or endorsed by Epic Games."
```

- [ ] **Step 2: Correr y ver que fallan** — Run: `npx playwright test tests/e2e/home-paper.spec.ts` → FAIL.

- [ ] **Step 3: Implementar** las cuatro secciones, sumarlas a `page.tsx` (el pie va fuera de `<main>`) y completar los mensajes en los tres idiomas.

- [ ] **Step 4: Correr y ver que pasa** — Run: `npm run test && npx playwright test && npm run lint && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/home src/app messages tests/e2e/home-paper.spec.ts
git commit -m "feat: servicios, pasos, preguntas frecuentes y pie de la home"
```

---

### Task 5: Metadatos, SEO y calidad (accesibilidad y responsive)

**Files:**
- Create: `src/lib/site-url.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`, `.env.example`
- Modify: `src/app/[locale]/layout.tsx` (`generateMetadata` completo)
- Test: `tests/e2e/seo.spec.ts`, `tests/e2e/quality.spec.ts`

**Interfaces:**
- Consumes: `routing`, `HTML_LANG`, `getPathname`, foto de `src/assets/tallami-wide-1920.jpg`.
- Produces: `SITE_URL: string` = `process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'`, sin barra final. `.env.example` documenta `NEXT_PUBLIC_SITE_URL=`.

`generateMetadata`: `metadataBase: new URL(SITE_URL)`; `title` y `description` del idioma; `alternates.canonical` = `/{locale}`; `alternates.languages` = `{ es: '/es', 'pt-BR': '/pt', en: '/en', 'x-default': '/es' }`; `openGraph` con `locale` (`es_AR`, `pt_BR`, `en_US`), `type: 'website'`, `siteName: 'Tallami Coaching'` y la foto de portada como imagen (con ancho, alto y alt); `themeColor` `#0B1433` vía `generateViewport`. `sitemap.ts`: una entrada por idioma con `alternates.languages`. `robots.ts`: permite todo y apunta al sitemap.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/e2e/seo.spec.ts`:
```ts
test('each locale declares canonical and hreflang alternates', …)
  // /pt: link[rel=canonical] termina en "/pt"; link[rel=alternate][hreflang=es|pt-BR|en|x-default]
  // con href terminado en /es, /pt, /en, /es
test('each locale has its own title and og:locale', …)  // /en: <title> no vacío y distinto del de /es; og:locale "en_US"
test('sitemap lists the three locales', …)  // GET /sitemap.xml → 200 y contiene "/es", "/pt", "/en"
```

`tests/e2e/quality.spec.ts`:
```ts
for (const locale of ['es','pt','en']) for (const width of [320, 375, 768, 1024, 1440])
  test(`no horizontal scroll on /${locale} at ${width}px`, …)
  // setViewportSize({ width, height: 900 }) → documentElement.scrollWidth <= clientWidth
for (const locale of ['es','pt','en']) for (const width of [375, 1440])
  test(`no serious or critical axe violations on /${locale} at ${width}px`, …)
  // new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()
  // → violations con impact serious|critical = []
test('skip link is the first focusable element and moves focus to main', …)
  // /es: Tab → foco en link "Saltar al contenido"; Enter → URL con #contenido
test('results table stacks on small phones', …)
  // 320px, /pt: el thead de #results table no se ve y ninguna fila supera el ancho del viewport
```

- [ ] **Step 2: Correr y ver que fallan** — Run: `npx playwright test tests/e2e/seo.spec.ts tests/e2e/quality.spec.ts` → FAIL en SEO. Si alguno de calidad falla, se arregla en el componente que corresponda, no en el test.

- [ ] **Step 3: Implementar** metadatos, sitemap, robots y `.env.example`, y corregir lo que marquen los tests de calidad.

- [ ] **Step 4: Verificación completa**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:e2e`
Expected: todo en verde, sin warnings de `next build` sobre `priority`, fuentes o metadata.

- [ ] **Step 5: Commit**

```bash
git add src/lib/site-url.ts src/app .env.example tests/e2e/seo.spec.ts tests/e2e/quality.spec.ts src/components
git commit -m "feat: metadatos por idioma, sitemap y pruebas de accesibilidad y responsive"
```
