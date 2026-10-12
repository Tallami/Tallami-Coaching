# Kit de skills y agentes — Tallami Coaching

## Instalación
Este kit vive en el repo `Tallami/tallami-coaching`. Clonalo (o sincronizá tu carpeta con él) y abrilo con Claude Code. Cuando te pregunte si confiás en la carpeta, respondé que sí: las skills y agentes se cargan solos y los servidores MCP se activan.

## Qué hay instalado

### Skills copiadas en `.claude/skills/` (funcionan sin instalar nada)
| Skill | Origen | Para qué |
| --- | --- | --- |
| frontend-design | anthropics/skills | Dirección estética propia antes de escribir UI |
| webapp-testing | anthropics/skills | Pruebas en navegador real con Playwright |
| web-design-guidelines | vercel-labs/agent-skills | 100+ reglas de UX y accesibilidad |
| react-best-practices | vercel-labs/agent-skills | Reglas de rendimiento para React y Next.js |
| composition-patterns | vercel-labs/agent-skills | Componentes bien armados y reutilizables |
| copywriting, cro, offers, pricing, launch, referrals | coreyhaines31/marketingskills | Textos de venta, conversión, precios y lanzamiento |
| seo-audit, schema, site-architecture | coreyhaines31/marketingskills | SEO técnico, datos estructurados y estructura del sitio |

### Skills de plugins, copiadas también en `.claude/skills/`
Antes se instalaban como plugins; ahora viven en el repo para que funcionen igual en tu PC y en la nube.
| Skills | Repo | Para qué |
| --- | --- | --- |
| brainstorming, writing-plans, executing-plans, subagent-driven-development, test-driven-development, systematic-debugging, verification-before-completion y el resto de Superpowers | obra/superpowers | Metodología: brainstorming, plan, subagentes, tests |
| ui-ux-pro-max | nextlevelbuilder/ui-ux-pro-max-skill | Sistema de diseño: paletas, tipografías, estilos (requiere Python 3) |
| web-quality-audit, performance, core-web-vitals, accessibility, seo, best-practices | addyosmani/web-quality-skills | Auditorías de velocidad, accesibilidad y SEO |

Para actualizarlas, pedile a Claude que las vuelva a copiar desde esos repos.

### Servidores MCP (`.mcp.json`)
- **context7**: documentación actualizada de Next.js, Supabase, Mercado Pago, etc. Usa el servidor remoto (HTTP), así que no necesita Node.
- **playwright**: abre la web en un navegador y prueba los flujos. Arranca con `cmd /c npx`, así que es para Windows y requiere Node.js 18 o superior (nodejs.org). En la nube, Claude prueba con el Playwright que ya trae el entorno y la skill `webapp-testing`.

### Subagentes (`.claude/agents/`, de VoltAgent/awesome-claude-code-subagents)
nextjs-developer, frontend-developer, fullstack-developer, ui-designer, payment-integration, seo-specialist, security-auditor, qa-expert, accessibility-tester, performance-engineer, content-marketer.

## Para más adelante
- **Mercado Pago MCP oficial**: se agrega cuando arranquemos con pagos (requiere tu cuenta de vendedor y OAuth).

## Archivos
- `CLAUDE.md`: el contexto del proyecto que Claude lee siempre (quién sos, servicios, precios, stack, reglas).
- `assets/tallami-foto.png`: tu foto principal.
