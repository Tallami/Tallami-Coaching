"use client";

import { needsOwnRate } from "@/admin/catalog";
import type { SaleFormValues } from "@/admin/sales/form-values";
import type { RateMode } from "@/admin/sales/schema";
import { CHOSEN_CHOICE_CLASSES } from "@/admin/ui/choice-classes";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface RateFieldsProps {
  values: Pick<SaleFormValues, "currency" | "rateMode" | "arsPerUnit" | "arsPerUsd">;
  errors: Record<string, string>;
  onChange: (patch: Partial<SaleFormValues>) => void;
}

const MODES: readonly { value: RateMode; label: string; description: string }[] = [
  {
    value: "auto",
    label: "Automático (BCRA)",
    description: "La última cotización oficial en o antes del día de cobro.",
  },
  {
    value: "manual",
    label: "Manual",
    description: "Los valores que escribas acá.",
  },
];

/**
 * Cómo se convierte la venta a pesos y a dólares: la cotización oficial del
 * día de cobro, o los valores que escribe Tallami. Los campos manuales
 * dependen de la moneda: en dólares y en pesos solo hacen falta los pesos por
 * dólar; en reales, también los pesos por real.
 */
export function RateFields({ values, errors, onChange }: RateFieldsProps) {
  const isManual = values.rateMode === "manual";
  const asksOwnRate = needsOwnRate(values.currency);

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Tipo de cambio" className="grid grid-cols-2 gap-3 narrow:grid-cols-1">
        {MODES.map(({ value, label, description }) => (
          <label
            key={value}
            className={cn(
              "flex min-h-12 cursor-pointer items-start gap-3 border-2 border-ink bg-white px-4 py-2.5 transition-[color,background-color,border-color] duration-150 hover:bg-gold/15",
              CHOSEN_CHOICE_CLASSES,
            )}
          >
            <input
              type="radio"
              name="rateMode"
              value={value}
              checked={values.rateMode === value}
              onChange={() => onChange({ rateMode: value })}
              className="mt-1.5 size-4 accent-gold"
            />
            <span className="flex flex-col">
              <span className="font-bold">{label}</span>
              <span className="text-[0.875rem] opacity-90">{description}</span>
            </span>
          </label>
        ))}
      </div>

      {errors.rateMode ? <Notice tone="error">{errors.rateMode}</Notice> : null}

      {isManual ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-5 narrow:grid-cols-1">
          {asksOwnRate ? (
            <Field
              id="sale-ars-per-unit"
              label="Pesos por real"
              hint="Cuántos pesos vale un real el día de cobro."
              error={errors.arsPerUnit}
            >
              {(control) => (
                <Input
                  {...control}
                  name="arsPerUnit"
                  inputMode="decimal"
                  autoComplete="off"
                  data-manual-rate=""
                  value={values.arsPerUnit}
                  onChange={(event) => onChange({ arsPerUnit: event.target.value })}
                />
              )}
            </Field>
          ) : null}
          <Field
            id="sale-ars-per-usd"
            label="Pesos por dólar"
            hint="Cuántos pesos vale un dólar el día de cobro, por ejemplo 1.512,50."
            error={errors.arsPerUsd}
          >
            {(control) => (
              <Input
                {...control}
                name="arsPerUsd"
                inputMode="decimal"
                autoComplete="off"
                data-manual-rate={asksOwnRate ? undefined : ""}
                value={values.arsPerUsd}
                onChange={(event) => onChange({ arsPerUsd: event.target.value })}
              />
            )}
          </Field>
        </div>
      ) : null}

      <p className="text-[0.875rem] text-ink-2">
        Confirmá con tu contador qué tipo de cambio corresponde.
      </p>
    </div>
  );
}
