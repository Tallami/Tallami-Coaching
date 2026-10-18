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
import { ADMIN_ROUTES } from "@/admin/routes";

export const ADMIN_SECTIONS = [
  { id: "overview", label: "Resumen", href: ADMIN_ROUTES.overview, icon: LayoutDashboardIcon },
  { id: "sales", label: "Ventas", href: ADMIN_ROUTES.sales, icon: ReceiptTextIcon },
  { id: "services", label: "Servicios", href: ADMIN_ROUTES.services, icon: LayersIcon },
  { id: "students", label: "Alumnos", href: ADMIN_ROUTES.students, icon: UsersIcon },
  { id: "billing", label: "Facturación", href: ADMIN_ROUTES.billing, icon: FileTextIcon },
  { id: "settings", label: "Configuración", href: ADMIN_ROUTES.settings, icon: SettingsIcon },
] as const satisfies readonly {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}[];

export type AdminSectionId = (typeof ADMIN_SECTIONS)[number]["id"];
