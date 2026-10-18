"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
} from "react";
import { INITIAL_INVOICING_FORM_STATE, type InvoicingAction } from "@/admin/billing/form-state";
import { MAX_INVOICE_NUMBER_LENGTH } from "@/admin/billing/limits";
import type { UninvoicedGroupView, UninvoicedRowView } from "@/admin/billing/uninvoiced-views";
import { INVOICE_TYPES } from "@/admin/catalog";
import { sumMinor } from "@/admin/metrics/math";
import { saleHref } from "@/admin/routes";
import { Field } from "@/admin/ui/field";
import { NoScriptNote } from "@/admin/ui/no-script-note";
import { Notice } from "@/admin/ui/notice";
import { PhoneSummary } from "@/admin/ui/phone-summary";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

interface UninvoicedListProps {
  groups: readonly UninvoicedGroupView[];
  /** Hoy en Argentina, "AAAA-MM-DD": la fecha con que arranca la factura. */
  today: string;
  /** Marca las ventas elegidas; ante un problema devuelve el estado con los errores. */
  action: InvoicingAction;
  /**
   * Lo que avisa el último marcado que salió bien (lo trae la dirección después de
   * marcar). Se ve mientras el formulario no recibe ninguna respuesta: si el
   * siguiente marcado falla, deja de mostrarse, porque ya no es lo último que pasó.
   */
  savedNotice?: string;
}

/**
 * Con más ventas elegidas que estas, "No requiere factura" pide confirmar: saca
 * de la lista todas las ventas de una vez (con "Elegir todas", hasta mil) y un
 * clic de más no se tiene que pagar con una lista vacía. Se puede deshacer, pero
 * de a una venta por vez.
 */
export const CONFIRM_NOT_REQUIRED_ABOVE = 5;

const INVOICE_TYPE_LABELS: Record<(typeof INVOICE_TYPES)[number], string> = {
  C: "Factura C",
  E: "Factura E",
};

const checkboxClasses = "size-5 cursor-pointer accent-zone";

interface TickProps {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  /** Solo las casillas de una venta viajan con el formulario. */
  name?: string;
  value?: string;
  className?: string;
}

/** Una casilla con un área de toque de 44 px; "a medias" cuando se eligió solo una parte del grupo. */
function Tick({ label, checked, indeterminate = false, onChange, name, value, className }: TickProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="-m-2 flex size-11 cursor-pointer items-center justify-center">
      <input
        ref={ref}
        type="checkbox"
        name={name}
        value={value}
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className={cn(checkboxClasses, className)}
      />
    </label>
  );
}

const numberCell = "text-right whitespace-nowrap tabular-nums";

function SaleRowView({
  row,
  checked,
  onToggle,
}: {
  row: UninvoicedRowView;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <TableRow className={cn(checked && "bg-gold/20")}>
      <TableCell className="w-12 pr-0">
        <Tick
          name="ids"
          value={row.id}
          label={`Elegir la venta de ${row.customerName}, ${row.item}, cobrada el ${row.paidOn}`}
          checked={checked}
          onChange={onToggle}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap narrow:px-2">{row.paidOn}</TableCell>
      <TableCell className="narrow:px-2">
        {/*
          En el celular esta celda trae también el servicio y el monto (ver PhoneSummary) y tiene que
          entrar entera en lo que se ve de la tabla (unos 300 px, con la casilla y la fecha): el
          recuadro interior fija su ancho y parte las palabras largas (un Discord) en lugar de
          ensancharla. Con 900 px o más no hace nada.
        */}
        <div className="narrow:w-[8rem] narrow:[overflow-wrap:anywhere]">
          <Link
            href={saleHref(row.id)}
            prefetch={false}
            className="rounded-[2px] font-bold underline decoration-ink-2/50 underline-offset-4 hover:decoration-ink"
          >
            {row.customerName}
          </Link>
          {row.customerDiscord || row.customerCountry ? (
            <div className="mt-0.5 flex items-center gap-2 text-[0.875rem] text-ink-2 narrow:flex-wrap">
              {row.customerDiscord ? <span>{row.customerDiscord}</span> : null}
              {row.customerCountry ? <Badge variant="outline">{row.customerCountry}</Badge> : null}
            </div>
          ) : null}
          <PhoneSummary service={row.item} amount={row.charged} />
        </div>
      </TableCell>
      <TableCell>
        <span className="font-semibold">{row.item}</span>
        {row.description ? (
          <div className="mt-0.5 max-w-[16rem] text-[0.875rem] text-ink-2">{row.description}</div>
        ) : null}
      </TableCell>
      <TableCell className={cn(numberCell, "font-bold")}>{row.charged}</TableCell>
      <TableCell className={numberCell}>{row.ars}</TableCell>
      <TableCell className={numberCell}>{row.usd}</TableCell>
    </TableRow>
  );
}

/** El texto de lo elegido, con sus totales para que se vea cuánto se está por marcar. */
function selectionSummary(rows: readonly UninvoicedRowView[]): string {
  if (rows.length === 0) return "Elegí las ventas que querés marcar.";
  const ars = formatMoney(sumMinor(rows.map((row) => row.arsMinor)), "ARS");
  const usd = formatMoney(sumMinor(rows.map((row) => row.usdMinor)), "USD");
  const noun = rows.length === 1 ? "venta elegida" : "ventas elegidas";
  return `${rows.length} ${noun}: ${ars} (${usd})`;
}

/**
 * Las ventas por facturar, por mes, y el formulario para marcar las que se
 * eligen: como facturadas (con el tipo, el número y la fecha de la factura) o
 * como "no requiere factura". Lo elegido y lo escrito viven en el estado y se
 * mandan a la acción como un `FormData` común; la validación es del servidor.
 *
 * El envío se hace a mano (`onSubmit`) y no con `<form action>`: React reinicia
 * el formulario después de cada acción y se perdería lo que se eligió y se
 * escribió justo cuando hay un error. El botón espera a que la página esté
 * lista. Al marcar, la acción redirige y la página trae la lista nueva (la
 * página pasa un `key` nuevo para que esta lista vuelva a armarse vacía).
 */
export function UninvoicedList({ groups, today, action, savedNotice }: UninvoicedListProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [values, setValues] = useState({ type: "", number: "", issuedOn: today });
  const [state, dispatch, isSaving] = useActionState(action, INITIAL_INVOICING_FORM_STATE);
  const [, startTransition] = useTransition();
  const [handledState, setHandledState] = useState(state);
  const [editedFields, setEditedFields] = useState<ReadonlySet<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const hydrated = useHydrated();

  // Una respuesta nueva del servidor: los errores vuelven a valer.
  if (state !== handledState) {
    setHandledState(state);
    setEditedFields(new Set());
  }

  // Lo que se corrigió después del error deja de mostrarse como error.
  const errors = Object.fromEntries(
    Object.entries(state.fieldErrors).filter(([field]) => !editedFields.has(field)),
  );

  useEffect(() => {
    if (state === INITIAL_INVOICING_FORM_STATE) return;
    const target =
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? summaryRef.current;
    target?.focus();
  }, [state]);

  const allRows = groups.flatMap((group) => group.rows);
  const chosenRows = allRows.filter((row) => selected.has(row.id));

  function markEdited(field: string) {
    setEditedFields((current) => new Set([...current, field]));
  }

  function select(ids: readonly string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    markEdited("ids");
  }

  function update(patch: Partial<typeof values>) {
    setValues((current) => ({ ...current, ...patch }));
    for (const field of Object.keys(patch)) markEdited(field);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // El botón que se tocó (`intent`) viaja con el formulario.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    // Si se confirmó desde el diálogo, se cierra: el resultado se ve en la lista.
    if (dialogRef.current?.open) dialogRef.current.close();
    startTransition(() => dispatch(formData));
  }

  /** "No requiere factura" con muchas ventas elegidas: antes de marcar, el diálogo pide confirmar. */
  function askToConfirm(event: MouseEvent<HTMLButtonElement>) {
    if (chosenRows.length <= CONFIRM_NOT_REQUIRED_ABOVE) return;
    event.preventDefault();
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  const everyRowChosen = allRows.length > 0 && chosenRows.length === allRows.length;
  const isBusy = !hydrated || isSaving;

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      aria-label="Marcar ventas como facturadas"
      data-hydrated={hydrated ? "true" : "false"}
      className="mt-5"
    >
      {savedNotice && state === INITIAL_INVOICING_FORM_STATE ? (
        <Notice tone="ok" className="mb-4">
          {savedNotice}
        </Notice>
      ) : null}
      <div ref={summaryRef} tabIndex={-1} className="outline-offset-0 empty:hidden">
        {state.formError ? (
          <Notice tone="error" className="mb-4 border-l-8">
            {state.formError}
          </Notice>
        ) : null}
        {errors.ids ? (
          <p id="ids-error" className="mb-4 text-[0.9375rem] leading-snug font-bold text-danger-ink">
            {errors.ids}
          </p>
        ) : null}
      </div>

      <div className="border-2 border-ink bg-white">
        <Table
          className="min-w-[56rem]"
          containerProps={{ role: "region", "aria-label": "Ventas sin facturar", tabIndex: 0 }}
        >
          <TableHeader>
            <TableRow className="border-b-0 hover:bg-transparent focus-within:bg-transparent">
              <TableHead className="w-12 pr-0">
                <Tick
                  label="Elegir todas las ventas sin facturar"
                  checked={everyRowChosen}
                  indeterminate={chosenRows.length > 0 && !everyRowChosen}
                  onChange={() => select(allRows.map((row) => row.id), !everyRowChosen)}
                  className="accent-gold"
                />
              </TableHead>
              <TableHead>Cobro</TableHead>
              <TableHead>Alumno</TableHead>
              <TableHead>Servicio</TableHead>
              <TableHead className="text-right">Cobrado</TableHead>
              <TableHead className="text-right">En pesos</TableHead>
              <TableHead className="text-right">En dólares</TableHead>
            </TableRow>
          </TableHeader>
          {groups.map((group) => {
            const ids = group.rows.map((row) => row.id);
            const chosenInGroup = ids.filter((id) => selected.has(id)).length;
            const allChosen = chosenInGroup === ids.length;
            return (
              <TableBody key={group.month} data-testid="uninvoiced-month" data-month={group.month}>
                <TableRow className="border-t-2 border-ink bg-neutral-tint hover:bg-neutral-tint focus-within:bg-neutral-tint">
                  <TableCell className="w-12 pr-0">
                    <Tick
                      label={`Elegir todas las ventas de ${group.label}`}
                      checked={allChosen}
                      indeterminate={chosenInGroup > 0 && !allChosen}
                      onChange={() => select(ids, !allChosen)}
                    />
                  </TableCell>
                  <TableCell colSpan={3} className="py-2.5">
                    <span className="text-[1.125rem] leading-tight font-extrabold [font-stretch:75%]">
                      {group.label}
                    </span>
                    <span className="ml-3 text-[0.9375rem] text-ink-2">
                      {group.count === 1 ? "1 venta" : `${group.count} ventas`}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5" />
                  <TableCell className={cn(numberCell, "py-2.5 font-bold")}>{group.ars}</TableCell>
                  <TableCell className={cn(numberCell, "py-2.5 font-bold")}>{group.usd}</TableCell>
                </TableRow>
                {group.rows.map((row) => (
                  <SaleRowView
                    key={row.id}
                    row={row}
                    checked={selected.has(row.id)}
                    onToggle={() => select([row.id], !selected.has(row.id))}
                  />
                ))}
              </TableBody>
            );
          })}
        </Table>
      </div>

      <div className="mt-4 border-2 border-l-[6px] border-ink border-l-gold bg-paper p-4 min-[901px]:sticky min-[901px]:bottom-3 min-[901px]:z-10 narrow:p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-6 gap-y-4 narrow:grid-cols-1">
          <p
            role="status"
            data-testid="selection-summary"
            className="col-span-2 text-[1.0625rem] font-bold narrow:col-span-1"
          >
            {selectionSummary(chosenRows)}
          </p>
          <div className="grid grid-cols-[9rem_minmax(0,1fr)_11rem] gap-4 narrow:grid-cols-1">
            <Field id="invoice-type" label="Tipo de factura" error={errors.type}>
              {(control) => (
                <NativeSelect
                  {...control}
                  name="type"
                  value={values.type}
                  onChange={(event) => update({ type: event.target.value })}
                >
                  <NativeSelectOption value="">Elegí uno</NativeSelectOption>
                  {INVOICE_TYPES.map((type) => (
                    <NativeSelectOption key={type} value={type}>
                      {INVOICE_TYPE_LABELS[type]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field
              id="invoice-number"
              label="Número de factura"
              hint="Como en ARCA: 00003-00000045."
              error={errors.number}
            >
              {(control) => (
                <Input
                  {...control}
                  name="number"
                  autoComplete="off"
                  maxLength={MAX_INVOICE_NUMBER_LENGTH}
                  value={values.number}
                  onChange={(event) => update({ number: event.target.value })}
                />
              )}
            </Field>
            <Field id="invoice-issued-on" label="Fecha de la factura" error={errors.issuedOn}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  name="issuedOn"
                  max={today}
                  value={values.issuedOn}
                  onChange={(event) => update({ issuedOn: event.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" name="intent" value="invoiced" disabled={isBusy}>
              {isSaving ? "Guardando…" : "Marcar como facturadas"}
            </Button>
            <Button
              type="submit"
              name="intent"
              value="not_required"
              variant="ink-outline"
              disabled={isBusy}
              onClick={askToConfirm}
            >
              {isSaving ? "Guardando…" : "No requiere factura"}
            </Button>
            <NoScriptNote />
          </div>
        </div>
      </div>

      {/* Dentro del formulario, así su botón de confirmar manda el mismo `intent` que el de la barra. */}
      <dialog
        ref={dialogRef}
        aria-labelledby="bulk-confirm-title"
        aria-describedby="bulk-confirm-description"
        onClick={(event) => {
          // Un clic en el fondo oscuro (fuera del recuadro) cierra, igual que Escape.
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] border-2 border-ink bg-white p-0 text-ink backdrop:bg-stage/70"
      >
        <div className="p-5">
          <h3 id="bulk-confirm-title" className="text-[1.375rem] leading-tight font-extrabold [font-stretch:75%]">
            {`¿Marcar ${chosenRows.length} ventas como «No requiere factura»?`}
          </h3>
          <p id="bulk-confirm-description" className="mt-2 text-ink-2">
            Salen de la lista de pendientes y no se facturan. Si fue un error, podés volver a pendiente cada una desde
            su ficha en Ventas, de a una por vez.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t-2 border-ink bg-paper px-5 py-4">
          <Button
            ref={cancelRef}
            type="button"
            variant="ink-outline"
            onClick={() => dialogRef.current?.close()}
          >
            Cancelar
          </Button>
          <Button type="submit" name="intent" value="not_required" disabled={isBusy}>
            {`Sí, marcar ${chosenRows.length} ventas`}
          </Button>
        </div>
      </dialog>
    </form>
  );
}
