"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CURRENCIES,
  CURRENCY_LABELS,
  ITEM_LABELS,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  SALE_ITEMS,
  SALE_STATUSES,
  STATUS_LABELS,
  isDollarCurrency,
  type Currency,
  type SaleItem,
} from "@/admin/catalog";
import { CustomerPicker } from "@/admin/sales/customer-picker";
import type { SaleFormValues } from "@/admin/sales/form-values";
import { INITIAL_SALE_FORM_STATE, type SaleFormState } from "@/admin/sales/form-state";
import { RateFields } from "@/admin/sales/rate-fields";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";

export interface SaleFormProps {
  mode: "create" | "edit";
  /** La acción que guarda; ante un problema devuelve el estado con los errores. */
  action: (state: SaleFormState, formData: FormData) => Promise<SaleFormState>;
  initialValues: SaleFormValues;
  /** Precio de lista en dólares enteros de cada servicio que tiene uno. */
  priceListUsd: Partial<Record<SaleItem, number>>;
  /** La venta que se edita ya tiene una factura emitida: el formulario avisa que, si cambia el monto, la moneda o la fecha, hay que revisarla. */
  invoiced?: boolean;
}

const SALES_PATH = "/admin/ventas";

// Un snapshot que siempre es `true` en el navegador y `false` al renderizar en
// el servidor: dice si la página ya está lista para usarse.
const subscribeNever = () => () => {};
const isHydrated = () => true;
const isNotHydrated = () => false;

/** El texto del monto sugerido: solo cuando se cobra en dólares y el servicio tiene precio de lista. */
function suggestedAmount(
  priceListUsd: SaleFormProps["priceListUsd"],
  item: string,
  currency: Currency,
): string | null {
  const price = priceListUsd[item as SaleItem];
  return price !== undefined && isDollarCurrency(currency) ? String(price) : null;
}

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** Cada bloque del formulario: un título a la izquierda y sus campos a la derecha. */
function FormSection({ title, description, children }: FormSectionProps) {
  const headingId = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={headingId}
      className="grid grid-cols-[13rem_minmax(0,1fr)] gap-x-10 gap-y-4 border-t border-rule px-6 py-7 first:border-t-0 narrow:grid-cols-1 narrow:px-5 narrow:py-6"
    >
      <div>
        <h2 id={headingId} className="text-[1.375rem] leading-tight font-extrabold [font-stretch:75%]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[0.875rem] leading-snug text-ink-2">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

const twoColumns = "grid grid-cols-2 gap-x-5 gap-y-5 narrow:grid-cols-1";
const threeColumns = "grid grid-cols-3 gap-x-5 gap-y-5 narrow:grid-cols-1";

/**
 * Formulario de alta y edición de una venta. Los valores viven en el estado del
 * formulario y se mandan a la acción como un `FormData` común. La validación y
 * el tipo de cambio son del servidor.
 *
 * El envío se hace a mano (`onSubmit`) y no con `<form action>`: React reinicia
 * el formulario después de cada acción, y eso deja las listas y las opciones
 * en su valor inicial aunque el estado diga otra cosa, justo cuando hay un
 * error y hay que conservar lo escrito. Por lo mismo, el botón de guardar
 * espera a que la página esté lista.
 */
export function SaleForm({ mode, action, initialValues, priceListUsd, invoiced = false }: SaleFormProps) {
  const [values, setValues] = useState(initialValues);
  const [autoFilledAmount, setAutoFilledAmount] = useState<string | null>(null);
  const [state, dispatch, isSaving] = useActionState(action, INITIAL_SALE_FORM_STATE);
  const [, startTransition] = useTransition();
  const [handledState, setHandledState] = useState(state);
  const [editedFields, setEditedFields] = useState<ReadonlySet<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(subscribeNever, isHydrated, isNotHydrated);

  // Una respuesta nueva del servidor: los errores vuelven a valer y, si no hay
  // dólar oficial, el formulario pasa al tipo de cambio manual.
  if (state !== handledState) {
    setHandledState(state);
    setEditedFields(new Set());
    if (state.needsManualRate) setValues((current) => ({ ...current, rateMode: "manual" }));
  }

  // Lo que se corrigió después del error deja de mostrarse como error.
  const errors = Object.fromEntries(
    Object.entries(state.fieldErrors).filter(([field]) => !editedFields.has(field)),
  );

  useEffect(() => {
    if (state === INITIAL_SALE_FORM_STATE) return;
    const form = formRef.current;
    const target =
      form?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      (state.needsManualRate ? form?.querySelector<HTMLElement>("[data-manual-rate]") : null) ??
      summaryRef.current;
    target?.focus();
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  function update(patch: Partial<SaleFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    setEditedFields((current) => new Set([...current, ...Object.keys(patch)]));
  }

  /** Cambia el servicio o la moneda y, si el monto era el sugerido (o estaba vacío), lo vuelve a sugerir. */
  function updateSuggesting(patch: Pick<Partial<SaleFormValues>, "item" | "currency">) {
    const next = { ...values, ...patch };
    const mayReplace = values.amount === "" || values.amount === autoFilledAmount;
    if (!mayReplace) return update(patch);
    const suggestion = suggestedAmount(priceListUsd, next.item, next.currency);
    setAutoFilledAmount(suggestion);
    update({ ...patch, amount: suggestion ?? "" });
  }

  const listPrice = priceListUsd[values.item as SaleItem];
  const showDescription = values.item === "other" || values.description !== "";

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      data-hydrated={hydrated ? "true" : "false"}
      className="border-2 border-ink bg-white"
    >
      <div ref={summaryRef} tabIndex={-1} className="outline-offset-0 empty:hidden">
        {state.formError ? (
          <Notice tone="error" className="border-l-8">
            {state.formError}
          </Notice>
        ) : null}
      </div>
      {invoiced ? (
        // Cambiar el monto, la moneda o la fecha de cobro no toca la factura: el aviso recuerda revisarla.
        <Notice tone="info">
          Esta venta ya tiene factura; si cambiás el monto, la moneda o la fecha, revisá la factura.
        </Notice>
      ) : null}

      <FormSection title="Alumno" description="Quién compró. Si es la primera vez, cargalo acá.">
        <CustomerPicker values={values} errors={errors} onChange={update} />
      </FormSection>

      <FormSection title="Venta" description="Qué se vendió y por cuánto.">
        <div className={twoColumns}>
          <Field id="sale-item" label="Servicio" error={errors.item} className="col-span-2 narrow:col-span-1">
            {(control) => (
              <NativeSelect
                {...control}
                name="item"
                value={values.item}
                onChange={(event) => updateSuggesting({ item: event.target.value })}
              >
                <NativeSelectOption value="">Elegí un servicio</NativeSelectOption>
                {SALE_ITEMS.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {ITEM_LABELS[item]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          {showDescription ? (
            <Field
              id="sale-description"
              label="Descripción"
              optional={values.item !== "other"}
              hint={values.item === "other" ? "Obligatoria para «Otro»." : undefined}
              error={errors.description}
              className="col-span-2 narrow:col-span-1"
            >
              {(control) => (
                <Input
                  {...control}
                  name="description"
                  maxLength={400}
                  autoComplete="off"
                  value={values.description}
                  onChange={(event) => update({ description: event.target.value })}
                />
              )}
            </Field>
          ) : null}
          <Field id="sale-currency" label="Moneda" error={errors.currency}>
            {(control) => (
              <NativeSelect
                {...control}
                name="currency"
                value={values.currency}
                onChange={(event) => updateSuggesting({ currency: event.target.value as Currency })}
              >
                {CURRENCIES.map((currency) => (
                  <NativeSelectOption key={currency} value={currency}>
                    {CURRENCY_LABELS[currency]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            id="sale-amount"
            label="Monto"
            hint={
              listPrice !== undefined
                ? `Precio de lista: ${formatMoney(listPrice * 100, "USD", { decimals: 0 })}`
                : "Con coma o punto para los centavos: 1.234,56."
            }
            error={errors.amount}
          >
            {(control) => (
              <Input
                {...control}
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                value={values.amount}
                onChange={(event) => update({ amount: event.target.value })}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Cobro"
        description="Cómo y cuándo se cobró. Los ingresos se cuentan por la fecha de cobro."
      >
        <div className={threeColumns}>
          <Field id="sale-payment-method" label="Medio de pago" error={errors.paymentMethod}>
            {(control) => (
              <NativeSelect
                {...control}
                name="paymentMethod"
                value={values.paymentMethod}
                onChange={(event) => update({ paymentMethod: event.target.value })}
              >
                <NativeSelectOption value="">Elegí uno</NativeSelectOption>
                {PAYMENT_METHODS.map((method) => (
                  <NativeSelectOption key={method} value={method}>
                    {PAYMENT_LABELS[method]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="sale-status" label="Estado" error={errors.status}>
            {(control) => (
              <NativeSelect
                {...control}
                name="status"
                value={values.status}
                onChange={(event) => update({ status: event.target.value })}
              >
                {SALE_STATUSES.map((status) => (
                  <NativeSelectOption key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            id="sale-paid-on"
            label="Fecha de cobro"
            hint="Obligatoria si está cobrada, entregada o reembolsada."
            error={errors.paidOn}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                name="paidOn"
                value={values.paidOn}
                onChange={(event) => update({ paidOn: event.target.value })}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <FormSection title="Entrega" description="Cuándo se entrega o se da la sesión. Horas de Argentina.">
        <div className={twoColumns}>
          <Field id="sale-due-at" label="Entrega o sesión comprometida" optional error={errors.dueAt}>
            {(control) => (
              <Input
                {...control}
                type="datetime-local"
                name="dueAt"
                value={values.dueAt}
                onChange={(event) => update({ dueAt: event.target.value })}
              />
            )}
          </Field>
          <Field
            id="sale-delivered-at"
            label="Entregada el"
            optional
            hint="Solo vale si la venta queda entregada: con otro estado se borra. Si queda entregada y la dejás vacía, se anota el momento en que guardás."
            error={errors.deliveredAt}
          >
            {(control) => (
              <Input
                {...control}
                type="datetime-local"
                name="deliveredAt"
                value={values.deliveredAt}
                onChange={(event) => update({ deliveredAt: event.target.value })}
              />
            )}
          </Field>
        </div>
      </FormSection>

      <FormSection title="Tipo de cambio" description="Con él se calcula cuánto es la venta en pesos y en dólares.">
        <RateFields values={values} errors={errors} onChange={update} />
      </FormSection>

      <FormSection title="Notas">
        <Field id="sale-notes" label="Notas de la venta" optional error={errors.notes}>
          {(control) => (
            <Textarea
              {...control}
              name="notes"
              maxLength={2200}
              value={values.notes}
              onChange={(event) => update({ notes: event.target.value })}
            />
          )}
        </Field>
      </FormSection>

      <div className="flex flex-wrap items-center gap-3 border-t-2 border-ink bg-paper px-6 py-4 narrow:px-5">
        <Button type="submit" disabled={!hydrated || isSaving}>
          {isSaving ? "Guardando…" : mode === "create" ? "Guardar venta" : "Guardar cambios"}
        </Button>
        <Button asChild variant="ink-outline">
          <Link href={SALES_PATH}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
