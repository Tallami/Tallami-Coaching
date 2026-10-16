import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { dateToArgentinaLocal, formatDay } from "@/admin/dates";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";
import { settingsToFormValues, type SettingsFormState } from "@/admin/settings/form-state";
import { SettingsForm } from "@/admin/settings/settings-form";
import { Notice } from "@/admin/ui/notice";

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

/** "15/10/2026, 14:30": un instante en hora de Argentina. */
function formatUpdatedAt(date: Date): string {
  const [day, time] = dateToArgentinaLocal(date).split("T");
  return `${formatDay(day)}, ${time}`;
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

/** El cuerpo de Configuración (el encabezado lo pone la página): el aviso de guardado y el formulario del monotributo. */
export function SettingsView({ current, updatedAt, justSaved, action }: SettingsViewProps) {
  return (
    <div className="max-w-3xl">
      {justSaved ? (
        <Notice tone="ok" className="mb-5">
          Configuración guardada.{" "}
          <Link href="/admin/facturacion" prefetch={false} className="underline underline-offset-2">
            Ver el medidor en Facturación
          </Link>
        </Notice>
      ) : null}
      <SettingsForm
        // Lo guardado puede volver normalizado (el tope con sus centavos): el formulario se arma de nuevo.
        key={updatedAt?.toISOString() ?? "sin-configuracion"}
        action={action}
        initialValues={settingsToFormValues(current)}
        footnote={
          updatedAt
            ? `Última actualización: ${formatUpdatedAt(updatedAt)}`
            : "Todavía no cargaste nada: el medidor del monotributo aparece cuando guardes."
        }
      >
        <SourceNote />
      </SettingsForm>
    </div>
  );
}
