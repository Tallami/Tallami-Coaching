import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { formatMoment } from "@/admin/dates";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";
import { settingsToFormValues, type SettingsFormState } from "@/admin/settings/form-state";
import { ADMIN_ROUTES } from "@/admin/routes";
import { SettingsForm } from "@/admin/settings/settings-form";
import { Button } from "@/components/ui/button";

/**
 * La tabla de categorías y montos vigentes del Monotributo en ARCA. Verificada
 * el 15/10/2026: responde 200 y es la página "Montos y categorías vigentes".
 * Si ARCA mueve la página, el enlace deja de servir: se revisa de vez en cuando.
 */
export const ARCA_MONOTRIBUTO_URL = "https://www.arca.gob.ar/monotributo/categorias.asp";

interface SettingsViewProps {
  current: MonotributoSettings | null;
  /** Cuándo se guardó por última vez, o `null` si todavía no se cargó nada. */
  updatedAt: Date | null;
  /** Se acaba de guardar: el aviso lo dice y lleva a ver el medidor. */
  justSaved: boolean;
  action: (state: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;
}

/** De dónde salen los datos y dónde ver la tabla: lo que nunca debe quedar sin decir. */
function SourceNote() {
  return (
    <div className="mt-1 border-l-4 border-info-ink bg-info-tint px-4 py-3 text-[0.9375rem] leading-snug text-info-ink">
      <p>
        Estos datos los cargás vos: el panel no los consulta en ARCA ni los verifica, y no reemplaza a tu contador.
        Confirmá con él qué categoría y qué tope te corresponden.
      </p>
      <p className="mt-2">
        <a
          href={ARCA_MONOTRIBUTO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 font-bold underline underline-offset-2"
        >
          Ver la tabla vigente en ARCA
          <ExternalLinkIcon className="size-4" aria-hidden="true" />
          <span className="sr-only">(se abre en otra pestaña)</span>
        </a>
      </p>
    </div>
  );
}

/** El paso a Configuración → Seguridad: las llaves de acceso, el código para otro dispositivo y las sesiones abiertas. */
function SecurityLink() {
  return (
    <section
      aria-labelledby="security-link-heading"
      className="mt-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-2 border-ink bg-white px-6 py-5 narrow:px-5"
    >
      <div className="min-w-0">
        <h2 id="security-link-heading" className="text-[1.375rem] leading-tight font-extrabold [font-stretch:75%]">
          Seguridad del ingreso
        </h2>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-snug text-ink-2">
          Tus llaves de acceso, el código para sumar otro dispositivo y las sesiones abiertas.
        </p>
      </div>
      <Button asChild variant="ink-outline" size="sm">
        <Link href={ADMIN_ROUTES.security} prefetch={false}>
          Abrir Seguridad
        </Link>
      </Button>
    </section>
  );
}

/** El cuerpo de Configuración (el encabezado lo pone la página): el aviso de guardado, el formulario del monotributo y el paso a Seguridad. */
export function SettingsView({ current, updatedAt, justSaved, action }: SettingsViewProps) {
  return (
    <div className="max-w-3xl">
      <SettingsForm
        savedNotice={
          justSaved ? (
            <>
              Configuración guardada.{" "}
              <Link href={ADMIN_ROUTES.billing} prefetch={false} className="underline underline-offset-2">
                Ver el medidor en Facturación
              </Link>
            </>
          ) : undefined
        }
        // Lo guardado puede volver normalizado (el tope con sus centavos): el formulario se arma de nuevo.
        key={updatedAt?.toISOString() ?? "sin-configuracion"}
        action={action}
        initialValues={settingsToFormValues(current)}
        footnote={
          updatedAt
            ? `Última actualización: ${formatMoment(updatedAt)}`
            : "Todavía no cargaste nada: el medidor del monotributo aparece cuando guardes."
        }
      >
        <SourceNote />
      </SettingsForm>
      <SecurityLink />
    </div>
  );
}
