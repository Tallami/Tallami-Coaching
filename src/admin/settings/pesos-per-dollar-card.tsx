import { formatMoment } from "@/admin/dates";
import { Notice } from "@/admin/ui/notice";
import { Field } from "@/admin/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRate } from "@/lib/money";
import type { PesosPerDollarRecord } from "@/payments/pricing";

/** Cómo volvió la página del último intento de guardar. */
export type PesosPerDollarOutcome = "saved" | "invalid" | undefined;

interface PesosPerDollarCardProps {
  current: PesosPerDollarRecord | null;
  outcome: PesosPerDollarOutcome;
  action: (formData: FormData) => Promise<void>;
}

/**
 * Los pesos por dólar con los que la web muestra el precio en pesos. Es un
 * formulario común del servidor: funciona también sin JavaScript. El valor
 * escrito se valida en el servidor.
 */
export function PesosPerDollarCard({ current, outcome, action }: PesosPerDollarCardProps) {
  const headingId = "pesos-per-dollar-heading";
  return (
    <section aria-labelledby={headingId} className="mt-6 border-2 border-ink bg-white">
      {outcome === "saved" ? <Notice tone="ok">Pesos por dólar guardados. La web ya muestra el valor nuevo.</Notice> : null}
      {outcome === "invalid" ? (
        <Notice tone="error" className="border-l-8">
          Ese valor no sirve: escribí un número mayor a cero, por ejemplo 1500 o 1.512,50.
        </Notice>
      ) : null}
      <form action={action} className="grid grid-cols-[13rem_minmax(0,1fr)] gap-x-10 gap-y-4 px-6 py-7 narrow:grid-cols-1 narrow:px-5 narrow:py-6">
        <div>
          <h2 id={headingId} className="text-[1.375rem] leading-tight font-extrabold [font-stretch:75%]">
            Pesos por dólar
          </h2>
          <p className="mt-1 text-[0.875rem] leading-snug text-ink-2">
            Con este valor la web muestra, debajo de cada precio en dólares, el precio en pesos.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <p className="text-[1.0625rem]" data-testid="pesos-per-dollar-current">
            {current ? (
              <>
                <strong>ARS {formatRate(current.rate)}</strong> por dólar. Guardado el {formatMoment(current.updatedAt)}.
              </>
            ) : (
              "Todavía no cargaste nada: la web muestra solo los precios en dólares."
            )}
          </p>
          <Field
            id="pesos-per-dollar"
            label="Valor en pesos"
            hint="Con coma o punto para los decimales: 1500 o 1.512,50."
          >
            {(control) => (
              <Input {...control} name="pesosPerDollar" inputMode="decimal" autoComplete="off" className="max-w-[14rem]" />
            )}
          </Field>
          <div>
            <Button type="submit">Guardar pesos por dólar</Button>
          </div>
        </div>
      </form>
    </section>
  );
}
