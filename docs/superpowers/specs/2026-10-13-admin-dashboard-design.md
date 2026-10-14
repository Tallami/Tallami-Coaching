# Panel de admin de Tallami Coaching

Fecha: 13 de octubre de 2026. Pedido de Tallami: "un dashboard de admin profesional y completo, con todas las ganancias, qué servicios se están contratando y cuáles no, que me sea fácil facturar lo que gano para el monotributo; hacelo como a vos te parezca". Pidió no responder preguntas: todas las decisiones de este documento son del diseñador salvo las citadas.

## Para qué

Tallami vende coaching por mensajes directos y todavía no hay pagos online. Necesita un solo lugar donde:

1. ver cuánto gana (en dólares y en pesos), cómo viene contra el período anterior y de dónde sale;
2. ver qué servicios se venden, cuáles no, y quiénes son sus alumnos;
3. no olvidarse de nada: entregas pendientes, sesiones próximas, ventas sin facturar;
4. saber cuánto lleva facturado en los últimos 12 meses para el monotributo y exportar las ventas para el contador.

## Objetivos

- Panel privado en `/admin`, en español, que se usa cómodo desde la compu y desde el celular.
- Carga manual de ventas y alumnos hoy; las mismas tablas las llenan los pagos online cuando existan (un pedido pagado = una venta con `source` del proveedor).
- Números confiables: montos en enteros (centavos), cada venta guarda su valor en la moneda cobrada, en pesos y en dólares, con el tipo de cambio usado y su fuente.
- Seguro: solo entra Tallami.

## No objetivos

- No emite facturas electrónicas en ARCA (eso queda para más adelante; hoy se factura a mano y el panel ayuda a saber qué y cuánto).
- No reemplaza al contador ni da asesoramiento impositivo: el panel suma lo que Tallami carga y lo compara con el tope que él carga.
- No hay usuarios múltiples ni roles.
- No cambia nada visible del sitio público, salvo el registro anónimo de clics en "Reservar" (sección "Interés por servicio").

## Lo que sería un fracaso aunque funcione

- Que alguien que no sea Tallami vea sus ingresos o los datos de sus alumnos.
- Que el panel sume mal: una venta cancelada contada como ingreso, un mes cortado en horario UTC en vez del de Argentina, o un redondeo que haga que los totales no coincidan con la lista.
- Que las páginas públicas dejen de ser estáticas o se pongan lentas por el panel.
- Que el panel dependa de un servicio externo para abrir (si el BCRA no responde, se carga el tipo de cambio a mano).

## Decisiones

### Datos y cuentas
- **Base:** Postgres con Drizzle ORM. Producción: Supabase, por `DATABASE_URL` (pooler de transacciones, `prepare: false`). Sin `DATABASE_URL` y fuera de Vercel: PGlite (Postgres dentro de Node) guardado en `.data/pglite` para usarlo y desarrollarlo localmente sin cuentas. Tests: PGlite en memoria. En Vercel sin `DATABASE_URL`, `/admin` muestra una página "falta configurar la base" y nunca usa PGlite.
- **Migraciones** SQL generadas con drizzle-kit y versionadas; PGlite las aplica al abrirse; para Supabase hay `npm run db:migrate`.
- **Zona horaria del negocio:** `America/Argentina/Buenos_Aires` para meses, "hoy" y vencimientos.
- **Qué es ingreso:** ventas en estado `paid` o `delivered`, contadas por su fecha de cobro (`paid_on`). `pending`, `cancelled` y `refunded` no suman.

### Ventas
- Campos: alumno, ítem (los servicios del sitio + "Pack de 4 clases" + "Otro" con descripción), moneda (USD, ARS, BRL, USDT), monto, medio de pago (Mercado Pago, Pix, PayPal, cripto, transferencia, efectivo, otro), estado, fecha de cobro, fecha comprometida de entrega o de sesión, fecha de entrega, factura (estado, tipo C o E, número, fecha) y notas.
- Precio sugerido al elegir el ítem, sacado de `src/content/services.ts`; editable.
- **Tipo de cambio:** al guardar se buscan los pesos por unidad de la moneda y los pesos por dólar del día de cobro en la API oficial del BCRA (`api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones`), usando la última cotización disponible en o antes de esa fecha (fines de semana y feriados). Se guardan en la venta con su fuente (`bcra` o `manual`). Si el BCRA no responde, el formulario pide el valor a mano. Las cotizaciones consultadas se guardan en una tabla para no repetir pedidos. El panel aclara: "confirmá con tu contador qué tipo de cambio corresponde".
- USDT se toma como dólar.
- Alta, edición y cambio de estado; no se borran ventas, se cancelan o reembolsan (quedan en el historial y no suman).

### Pantallas
1. **Resumen** (`/admin`), con selector de período (este mes, mes pasado, últimos 30 días, últimos 12 meses, este año) y comparación con el período anterior equivalente:
   - Tarjetas: ingresos en USD y en ARS (con variación), ventas, ticket promedio, alumnos nuevos, porcentaje de recompra.
   - Ingresos por mes de los últimos 12 meses (barras, USD).
   - Ingresos por servicio en el período, y los servicios sin ventas en los últimos 90 días.
   - Medios de pago y países de los alumnos en el período.
   - Pendientes: entregas por vencer o vencidas (VOD grabado y plan de juego), sesiones de los próximos 7 días, ventas cobradas sin facturar (cantidad y total en pesos).
   - Monotributo: ingresos en pesos de los últimos 12 meses contra el tope anual de la categoría cargada (porcentaje usado y cuánto queda).
2. **Ventas** (`/admin/ventas`): tabla con filtros (fechas, servicio, estado, medio de pago, factura) y búsqueda por alumno, paginada; alta y edición; exportación CSV de lo filtrado.
3. **Servicios** (`/admin/servicios`): por servicio, ventas, ingresos, ticket promedio, porcentaje del total, tendencia de los últimos 6 meses, última venta; clics en "Reservar" y conversión (ver "Interés por servicio").
4. **Alumnos** (`/admin/alumnos`): lista con país, compras, total gastado, primera y última compra y servicios; ficha con su historial; alta y edición.
5. **Facturación** (`/admin/facturacion`): ventas cobradas sin facturar agrupadas por mes, con totales en pesos y dólares; marcar una o varias como facturadas (tipo, número, fecha) o "no requiere"; resumen mensual cobrado contra facturado; el estado del monotributo; exportación CSV para el contador.
6. **Configuración** (`/admin/configuracion`): categoría del monotributo, tope anual en pesos y desde cuándo rige (con link a la tabla vigente de ARCA), cuándo se actualizó.

### Interés por servicio
- Cada clic en un botón de reserva del sitio público registra un evento anónimo: servicio, idioma, país (del encabezado de Vercel, si existe) y fecha. Sin cookies ni datos personales. Se envía con `navigator.sendBeacon` desde un componente chico de cliente; las páginas siguen estáticas.
- `/api/interest` valida el servicio, descarta bots por user-agent y limita a 30 eventos por minuto por IP (la IP se guarda solo como hash).
- En Servicios: clics, ventas y conversión (ventas / clics) por servicio en el período.

### Acceso
- Contraseña única de Tallami: su hash (scrypt) va en `ADMIN_PASSWORD_HASH`; `npm run admin:password` genera el hash. La sesión es un JWT firmado con `ADMIN_SESSION_SECRET` en una cookie `httpOnly`, `Secure` en producción, `SameSite=Strict`, válida 12 horas.
- Máximo 5 intentos fallidos por IP cada 15 minutos (guardados en la base, IP como hash).
- Protección doble: el `proxy` redirige a `/admin/login` sin sesión válida, y cada página y cada acción del servidor vuelve a verificar la sesión.
- `/admin` fuera de next-intl (sin prefijo de idioma), con `noindex` y bloqueado en `robots.txt`.

### Diseño visual
- La misma marca del sitio (azul escenario, dorado, papel, Saira), en una interfaz de trabajo: barra lateral con las secciones (menú desplegable en el celular), contenido sobre fondo claro, tarjetas y tablas densas pero legibles.
- Componentes de shadcn/ui (tabla, formularios, diálogos, selects, badges) adaptados a los tokens del sitio.
- Gráficos dibujados en SVG desde el servidor, siguiendo la skill `dataviz` del proyecto; sin librería de gráficos.
- Estados vacíos con una acción clara ("Cargá tu primera venta").

### Exportación CSV
- Separador `;`, coma decimal, UTF-8 con BOM (se abre bien en Excel en español). Celdas que empiezan con `=`, `+`, `-` o `@` se escapan para evitar fórmulas.

### Datos de ejemplo
- `npm run db:seed:demo` carga ventas y alumnos ficticios, claramente marcados, **solo en la base local**: se niega a correr con `DATABASE_URL`.

## Queda a criterio de quien lo construya

- Estructura exacta de archivos y componentes dentro de `src/admin/` y `src/app/admin/`.
- Paginación, orden por defecto y tamaños de tabla.
- Cómo se ven exactamente los gráficos, dentro de la guía de `dataviz` y los tokens de la marca.
