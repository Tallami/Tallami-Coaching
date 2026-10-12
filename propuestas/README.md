# Propuestas de home

Tres direcciones visuales para la home, con el mismo contenido (foto, resultados y servicios con precios del `CLAUDE.md`). Abrí cada HTML con doble clic; las fuentes se cargan de Google Fonts, así que necesitás internet.

| Archivo | Dirección | Paleta | Tipografía | El elemento que se recuerda |
| --- | --- | --- | --- | --- |
| `a-transmision.html` | Transmisión de torneo | Navy de escenario `#0B1433`, azul de luz `#3D5BDB`, dorado para los 1º `#FFC93C` | Saira (una sola familia, ancho variable) | Cartel de nombre tipo transmisión y tabla de posiciones |
| `b-pizarra.html` | Pizarra de coach (telestrator) | Papel gris verdoso `#EEF1EC`, tinta `#17202A`, marcador rojo `#C0211A`, azul de zona `#2457C5` | Bricolage Grotesque + Permanent Marker en las anotaciones | Círculo de zona y marcas a mano sobre los resultados |
| `c-analisis.html` | A + B: transmisión para el jugador, pizarra para elegir | Las de A en portada y resultados; las de B en servicios, pasos y preguntas | Saira + Permanent Marker | Marcas de telestrator sobre la transmisión, que siguen en la pizarra |

La propuesta C sale del [análisis de mercado](analisis-mercado.md). La anterior C (celeste universitaria) se descartó.

## Revisión
El agente `ui-designer` revisó las tres y se pasaron por las reglas de `web-design-guidelines`. Su recomendación final es C. Ya están aplicados estos cambios:
- Tallami figura como coach freelance. Los resultados son "de jugadores que entrené" y no se habla de "equipos" (el servicio de torneo es por dúo o trío).
- En C, los primeros puestos van en tabla con los jugadores, y Globals y EWC en una lista aparte, porque no hay nombres de jugadores para esos torneos.
- En C, los precios llevan su unidad ("por dúo o trío", "por mes", "por jugador + 6% de premios"), y la nota para menores aparece junto a los precios.
- C suma una sección de preguntas frecuentes (menores, pagos, agenda y Temporada Pro).
- Al pie: "No afiliado ni respaldado por Epic Games".
- Selector ES/PT/EN, navegación en móvil, botones con texto específico, contraste AA y sin scroll horizontal de 320 a 1440 px.

## Pendiente
- Confirmar las descripciones de cada servicio. Las de VOD, clase, plan, torneo, Academia y Temporada Pro son provisorias.
- Los botones de reserva apuntan a `#`, y el flujo de pago y agenda que se describe todavía no existe (fase de pagos).
- Si querés, sumar los jugadores de Globals y EWC (con su permiso) y enlaces públicos a los resultados.
- Reseñas reales de jugadores, cuando las tengas.
