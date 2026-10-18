import Link from "next/link";
import type { ReactNode } from "react";
import { ADMIN_SECTIONS, type AdminSectionId } from "@/admin/ui/sections";
import { SidebarFrame } from "@/admin/ui/sidebar-frame";
import { SubmitButton } from "@/components/admin/submit-button";
import { cn } from "@/lib/utils";

interface AdminShellProps {
  /** La sección que se está viendo; queda marcada en la barra lateral. */
  active: AdminSectionId;
  /** Lo que hace el botón Salir (cierra la sesión). Las páginas lo reciben ya conectado de `PanelShell`. */
  logoutAction: () => void | Promise<void>;
  children: ReactNode;
}

/**
 * El marco de toda página del panel (menos el login y la configuración
 * inicial): barra lateral con las secciones y el botón Salir, y el contenido
 * al lado. Cada página lo usa como raíz, después de `await requireAdmin()`,
 * a través de `PanelShell` (`src/app/admin/panel-shell.tsx`), que le da la
 * acción de salir:
 *
 *   export default async function Page() {
 *     await requireAdmin();
 *     return (
 *       <PanelShell active="sales">
 *         <PageHeader title="Ventas" />
 *         …
 *       </PanelShell>
 *     );
 *   }
 *
 * No lee datos, así que no verifica la sesión: eso es de la página.
 */
export function AdminShell({ active, logoutAction, children }: AdminShellProps) {
  return (
    <>
      <a
        href="#contenido"
        className="sr-only bg-gold px-4 py-2 font-bold text-stage focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Saltar al contenido
      </a>
      <div className="grid min-h-dvh grid-cols-[15.5rem_minmax(0,1fr)] narrow:grid-cols-1 narrow:grid-rows-[auto_1fr]">
        <SidebarFrame>
          <nav aria-label="Secciones del panel">
            <ul className="flex flex-col gap-1">
              {ADMIN_SECTIONS.map(({ id, label, href, icon: Icon }) => {
                const isActive = id === active;
                return (
                  <li key={id}>
                    <Link
                      href={href}
                      prefetch={false}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "relative flex min-h-11 items-center gap-3 rounded-[4px] px-3 font-semibold transition-[color,background-color,border-color] duration-150",
                        isActive
                          ? "bg-stage-2 text-on-stage"
                          : "text-on-stage-2 hover:bg-stage-2/70 hover:text-on-stage",
                      )}
                    >
                      {isActive ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-gold"
                        />
                      ) : null}
                      <Icon className="size-[1.15rem] shrink-0" aria-hidden="true" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <form action={logoutAction} className="mt-auto">
            <SubmitButton variant="stage-outline" size="sm" pendingLabel="Saliendo…" className="w-full">
              Salir
            </SubmitButton>
          </form>
        </SidebarFrame>
        <main id="contenido" className="min-w-0 px-gutter py-8 narrow:py-5">
          <div className="mx-auto w-full max-w-[1240px]">{children}</div>
        </main>
      </div>
    </>
  );
}
