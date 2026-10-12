# Propuestas de home

Tres direcciones visuales para la home, con el mismo contenido (foto, resultados y servicios con precios del `CLAUDE.md`). Abrí cada HTML con doble clic; las fuentes se cargan de Google Fonts, así que necesitás internet.

| Archivo | Dirección | Paleta | Tipografía | El elemento que se recuerda |
| --- | --- | --- | --- | --- |
| `a-transmision.html` | Transmisión de torneo | Navy de escenario `#0B1433`, azul de luz `#3D5BDB`, dorado para los 1º `#FFC93C` | Saira (una sola familia, ancho variable) | Lower third de transmisión y tabla tipo leaderboard |
| `b-pizarra.html` | Pizarra de coach (telestrator) | Papel gris verdoso `#EEF1EC`, tinta `#17202A`, marcador rojo `#C0211A`, azul de zona `#2457C5` | Bricolage Grotesque + Permanent Marker en las anotaciones | Círculo de zona y marcas a mano sobre los resultados |
| `c-celeste.html` | Vitrina universitaria (varsity) | Celeste `#8EC5EE`, navy `#0A1F44`, dorado `#E2B23A` | Graduate + Archivo | Parches de campeón y precios como números de camiseta |

Las tres partieron de `ui-ux-pro-max --design-system` y de `frontend-design`. Las paletas genéricas que sugería la base de datos (violeta neón con rosa) se reemplazaron por colores sacados de la foto y del mundo del torneo.

## Revisión
Las revisó el agente `ui-designer` y se pasaron por las reglas de `web-design-guidelines`. Ya están aplicados estos cambios:
- Titular corregido a "el coach detrás de 3 títulos de FNCS" (antes decía "tres campeones", y fueron 5 jugadores).
- Se quitó "los cupos son limitados", que no está respaldado.
- Selector de idioma ES/PT/EN y navegación visible en móvil.
- Botones con texto específico ("Reservar VOD grabado" en vez de "Reservar" repetido).
- Contrastes: marcador rojo de B a 5,3:1 y bordes de botón de A a más de 3:1.
- Sin scroll horizontal a 320 px; foto y titular reordenados en móvil.
- En C, el titular pasó a estar dentro de `main` y se agregó "USD" visible en los números.

Ranking del revisor: **A** (mejor primer pantallazo y estética neutral para AR, BR y MX), **B** (la que mejor guía la elección y da más confianza al adulto que paga), **C** (la más original, pero el celeste remite a la selección argentina).

## Pendiente
- Los botones de reserva apuntan a `#` hasta tener el checkout.
- Faltan los nombres de los equipos en Globals y EWC y las temporadas de Reload Elite y Second Chance.
- Confirmar las descripciones de Academia Tallami y Temporada Pro.
