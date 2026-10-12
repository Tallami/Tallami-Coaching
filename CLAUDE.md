# Tallami Coaching — web oficial

Sitio para vender los servicios de coaching de Fortnite competitivo de Tomás Allami ("Tallami").
Plan completo del proyecto: https://claude.ai/code/artifact/591e86f6-ddbb-4512-93eb-916d8db9263c

## Quién es Tallami
- Coach de Fortnite competitivo, Argentina. Redes: x.com/tallami1, twitch.tv/tallami, youtube.com/@tallami1, instagram.com/tallami1, tiktok.com/@tallami
- Palmarés como coach: 3 victorias de FNCS (CH5S2 con Randu & Lewa, CH5S3 con K1ng & Fazer, CH6S1 con K1ng & Fazer & Phzin), Reload Elite 1º (Phzin & Edson; Romero & Lewa), Second Chance 1º (K1ng & Fazer), Globals 2024 (22º), 2025 (11º y 12º), 2026 (14º), EWC ESL 9º, EWC Reload 5º.
- USD 45.300 en ganancias de coaching registradas desde CH5S4.
- Los jugadores del Excel de coaching autorizaron mostrar su nombre y resultado.

## Público
Jugadores competitivos de Latinoamérica: Argentina, Brasil y México primero. Muchos son menores de edad: el checkout lo acepta y paga un adulto responsable.

## Idiomas
Español (principal), portugués de Brasil e inglés. Rutas `/es`, `/pt`, `/en` con next-intl.

## Stack
Next.js (App Router) + TypeScript + Tailwind + shadcn/ui · Vercel · Supabase (DB, login con Discord y Google, storage) · Sanity (CMS) · Cal.com · Resend · bot de Discord.

## Pagos (fase posterior)
Mercado Pago (Argentina) · dLocal Go (Pix y resto de LATAM) · PayPal (exterior) · NOWPayments (cripto). Todos los proveedores escriben en una sola tabla de pedidos; un pedido pagado dispara email, rol en Discord, link para agendar y entrega en el portal.

## Servicios y precios (USD)
| Servicio | Precio |
| --- | --- |
| VOD review grabado (entrega 72 h) | 30 |
| VOD review en vivo (60 min) | 45 |
| Clase 1 a 1 (60 min) | 40 · pack de 4: 140 |
| Plan de juego personalizado | 120 |
| Coaching de torneo (dúo/trío) | 150 por equipo |
| Academia Tallami | 15 por mes |
| Temporada Pro | 200 por jugador + 6% de premios (por aplicación) |

## Cómo trabajar en este proyecto
1. Antes de construir, usá el flujo de Superpowers: brainstorming → plan → ejecución por subagentes → tests.
2. UI: aplicá `frontend-design` y la skill `ui-ux-pro-max`; revisá con `web-design-guidelines` y `react-best-practices`.
3. Documentación de librerías: consultala con el MCP `context7`, nunca de memoria. Si context7 no está disponible (por ejemplo en la nube), usá la documentación oficial vía búsqueda web.
4. Probá cada flujo de compra con el MCP `playwright` (o, en la nube, con la skill `webapp-testing`) antes de dar algo por terminado.
5. Antes de cada deploy: `web-quality-audit` (velocidad, accesibilidad, SEO).
6. Textos de venta: `copywriting`, `cro`, `offers`; nunca inventar testimonios ni resultados.
7. Todas las skills (incluidas Superpowers, ui-ux-pro-max y web-quality-skills) viven en `.claude/skills/`.
8. Subagentes disponibles en `.claude/agents/`: nextjs-developer, frontend-developer, fullstack-developer, ui-designer, payment-integration, seo-specialist, security-auditor, qa-expert, accessibility-tester, performance-engineer, content-marketer.
