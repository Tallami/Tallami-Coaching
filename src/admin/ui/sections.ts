// Las secciones del panel, en el orden de la barra lateral. Agregar una sección
// es agregarla acá y crear su página con `<AdminShell active="…">`.

import {
  FileTextIcon,
  LayoutDashboardIcon,
  LayersIcon,
  ReceiptTextIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

export const ADMIN_SECTIONS = [
  { id: "overview", label: "Resumen", href: "/admin", icon: LayoutDashboardIcon },
  { id: "sales", label: "Ventas", href: "/admin/ventas", icon: ReceiptTextIcon },
  { id: "services", label: "Servicios", href: "/admin/servicios", icon: LayersIcon },
  { id: "students", label: "Alumnos", href: "/admin/alumnos", icon: UsersIcon },
  { id: "billing", label: "Facturación", href: "/admin/facturacion", icon: FileTextIcon },
  { id: "settings", label: "Configuración", href: "/admin/configuracion", icon: SettingsIcon },
] as const satisfies readonly {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}[];

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]["id"];
