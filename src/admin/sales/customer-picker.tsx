"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { CustomerOption } from "@/admin/customers/repository";
import { customerLabel, type SaleFormValues } from "@/admin/sales/form-values";
import { Field } from "@/admin/ui/field";
import { searchCustomersAction } from "@/app/admin/ventas/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Espera tras la última tecla antes de buscar. */
const SEARCH_DELAY_MS = 200;

type PickerValues = Pick<
  SaleFormValues,
  | "customerMode"
  | "customerId"
  | "customerLabel"
  | "customerName"
  | "customerDiscord"
  | "customerCountry"
>;

interface CustomerPickerProps {
  values: PickerValues;
  errors: Record<string, string>;
  onChange: (patch: Partial<SaleFormValues>) => void;
}

const MODES = [
  { value: "existing", label: "Alumno existente" },
  { value: "new", label: "Alumno nuevo" },
] as const;

/**
 * El alumno de la venta: buscar uno ya cargado por nombre o Discord, o dar de
 * alta uno nuevo ahí mismo. Manda `customerMode` y, según el modo, el alumno
 * elegido (`customerId`) o los datos del nuevo.
 */
export function CustomerPicker({ values, errors, onChange }: CustomerPickerProps) {
  const [focusSearch, setFocusSearch] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Alumno" className="grid grid-cols-2 gap-3 narrow:grid-cols-1">
        {MODES.map(({ value, label }) => (
          <label
            key={value}
            className="flex min-h-12 cursor-pointer items-center gap-3 border-2 border-ink bg-white px-4 font-bold transition-[color,background-color,border-color] duration-150 hover:bg-gold/15 has-[:checked]:bg-stage has-[:checked]:text-on-stage"
          >
            <input
              type="radio"
              name="customerMode"
              value={value}
              checked={values.customerMode === value}
              onChange={() => onChange({ customerMode: value })}
              className="size-4 accent-gold"
            />
            {label}
          </label>
        ))}
      </div>

      {values.customerMode === "existing" ? (
        <>
          <input type="hidden" name="customerId" value={values.customerId} />
          {values.customerId ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-paper px-4 py-3">
              <p className="min-w-0 font-bold break-words">{values.customerLabel}</p>
              <Button
                type="button"
                variant="ink-outline"
                size="sm"
                onClick={() => {
                  onChange({ customerId: "", customerLabel: "" });
                  setFocusSearch(true);
                }}
              >
                Cambiar alumno
              </Button>
            </div>
          ) : (
            <CustomerSearch
              autoFocus={focusSearch}
              error={errors.customerId ?? errors.customer}
              onPick={(option) =>
                onChange({
                  customerId: option.id,
                  customerLabel: customerLabel(option.name, option.discord),
                })
              }
            />
          )}
        </>
      ) : (
        <div className="grid grid-cols-[2fr_1fr_1fr] gap-x-5 gap-y-5 narrow:grid-cols-1">
          <Field id="sale-customer-name" label="Nombre" error={errors.customerName ?? errors.customer}>
            {(control) => (
              <Input
                {...control}
                name="customerName"
                autoComplete="off"
                maxLength={200}
                value={values.customerName}
                onChange={(event) => onChange({ customerName: event.target.value })}
              />
            )}
          </Field>
          <Field id="sale-customer-discord" label="Discord" optional error={errors.customerDiscord}>
            {(control) => (
              <Input
                {...control}
                name="customerDiscord"
                autoComplete="off"
                maxLength={200}
                value={values.customerDiscord}
                onChange={(event) => onChange({ customerDiscord: event.target.value })}
              />
            )}
          </Field>
          <Field
            id="sale-customer-country"
            label="País"
            optional
            hint="2 letras: AR, BR, MX."
            error={errors.customerCountry}
          >
            {(control) => (
              <Input
                {...control}
                name="customerCountry"
                autoComplete="off"
                maxLength={8}
                value={values.customerCountry}
                onChange={(event) => onChange({ customerCountry: event.target.value })}
              />
            )}
          </Field>
        </div>
      )}
    </div>
  );
}

interface CustomerSearchProps {
  autoFocus: boolean;
  error?: string;
  onPick: (option: CustomerOption) => void;
}

/** Cuadro de búsqueda con lista de resultados (patrón combobox de ARIA). */
function CustomerSearch({ autoFocus, error, onPick }: CustomerSearchProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const latestRequest = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const listId = useId();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function scheduleSearch(text: string) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const request = ++latestRequest.current;
      try {
        const found = await searchCustomersAction(text);
        if (request !== latestRequest.current) return;
        setOptions(found);
        setFailed(false);
      } catch (searchError) {
        if (request !== latestRequest.current) return;
        console.error("Panel: no se pudo buscar alumnos.", searchError);
        setOptions([]);
        setFailed(true);
      }
      setHasSearched(true);
      setActiveIndex(-1);
    }, SEARCH_DELAY_MS);
  }

  function open(text: string) {
    setIsOpen(true);
    scheduleSearch(text);
  }

  function choose(option: CustomerOption) {
    setIsOpen(false);
    onPick(option);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      return;
    }
    if (!isOpen && event.key === "ArrowDown") {
      event.preventDefault();
      open(query);
      return;
    }
    if (!isOpen || options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      // Enter elige al alumno marcado; no envía el formulario.
      event.preventDefault();
      choose(options[activeIndex]);
    }
  }

  const showEmpty = isOpen && hasSearched && !failed && options.length === 0;

  return (
    <div className="relative">
      <Field
        id="sale-customer-search"
        label="Buscar alumno"
        hint="Escribí parte del nombre o del Discord."
        error={error}
      >
        {(control) => (
          <Input
            {...control}
            type="search"
            role="combobox"
            aria-expanded={isOpen && options.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            maxLength={100}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              open(event.target.value);
            }}
            onFocus={() => open(query)}
            onBlur={() => setIsOpen(false)}
            onKeyDown={handleKeyDown}
          />
        )}
      </Field>
      <ul
        id={listId}
        role="listbox"
        aria-label="Alumnos encontrados"
        hidden={!isOpen || options.length === 0}
        className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto border-2 border-ink bg-white shadow-[4px_4px_0_0_var(--color-ink)]"
      >
        {options.map((option, index) => (
          <li
            key={option.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            // `mousedown` evita que el cuadro pierda el foco (y cierre la lista) antes del clic.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
            className={cn(
              "flex cursor-pointer flex-wrap items-center gap-x-3 px-3 py-2.5",
              index === activeIndex ? "bg-gold/30" : "hover:bg-gold/15",
            )}
          >
            <span className="font-bold">{option.name}</span>
            {option.discord ? <span className="text-[0.875rem] text-ink-2">{option.discord}</span> : null}
            {option.country ? <Badge variant="outline">{option.country}</Badge> : null}
          </li>
        ))}
      </ul>
      <p role="status" className="mt-2 text-[0.9375rem] text-ink-2 empty:hidden">
        {failed ? "No pudimos buscar alumnos. Probá de nuevo." : null}
        {showEmpty ? "Nadie coincide. Probá con otro texto o elegí «Alumno nuevo»." : null}
      </p>
    </div>
  );
}
