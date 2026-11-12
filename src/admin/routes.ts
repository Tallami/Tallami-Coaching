// Las direcciones del panel, en un solo lugar: cada enlace, cada formulario y
// cada redirección las lee de acá en vez de escribir el texto. Las de ingreso
// (`/admin/login`, `/admin/setup`) viven con la guarda, en
// `src/admin/auth/redirect.ts`.

export const ADMIN_ROUTES = {
  overview: "/admin",
  sales: "/admin/ventas",
  newSale: "/admin/ventas/nueva",
  salesExport: "/admin/ventas/exportar",
  applications: "/admin/aplicaciones",
  siteRequests: "/admin/pedidos",
  messages: "/admin/mensajes",
  students: "/admin/alumnos",
  newStudent: "/admin/alumnos/nuevo",
  services: "/admin/servicios",
  billing: "/admin/facturacion",
  billingExport: "/admin/facturacion/exportar",
  settings: "/admin/configuracion",
  security: "/admin/configuracion/seguridad",
} as const;

/** La ficha (y edición) de la venta `id`. */
export function saleHref(id: string): string {
  return `${ADMIN_ROUTES.sales}/${id}`;
}

/** El PDF de la entrega `deliveryId` de la venta `saleId` (solo con sesión del panel). */
export function saleDeliveryFileHref(saleId: string, deliveryId: string): string {
  return `${saleHref(saleId)}/entregas/${deliveryId}`;
}

/** La ficha del alumno `id`. */
export function studentHref(id: string): string {
  return `${ADMIN_ROUTES.students}/${id}`;
}

/** La conversación con el alumno `customerId`. */
export function conversationHref(customerId: string): string {
  return `${ADMIN_ROUTES.messages}/${customerId}`;
}

/** La ficha de la aplicación a Temporada Pro `id`. */
export function applicationHref(id: string): string {
  return `${ADMIN_ROUTES.applications}/${id}`;
}
