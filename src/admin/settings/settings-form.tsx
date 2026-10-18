"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  INITIAL_SETTINGS_FORM_STATE,
  type SettingsFormState,
  type SettingsFormValues,
} from "@/admin/settings/form-state";
import { MONOTRIBUTO_CATEGORIES } from "@/admin/settings/categories";
import { Field } from "@/admin/ui/field";
import { NoScriptNote } from "@/admin/ui/no-script-note";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export interface SettingsFormProps {
  /** La acción que guarda; ante un problema devuelve el estado con los errores. */
  action: (state: SettingsFormState, formData: FormData) => Promise<SettingsFormState>;
  initialValues: SettingsFormValues;
  /** Qué se ve junto al botón de guardar: cuándo se actualizó por última vez. */
  footnote: ReactNode;
  /** Lo que va debajo de los campos: de dónde sale cada dato y el link a la tabla. */
  children?: ReactNode;
  /**
   * Lo que avisa un guardado que salió bien (lo trae la dirección después de
   * guardar). Se ve mientras el formulario no recibe ninguna respuesta: si un
   * guardado posterior falla, deja de mostrarse, porque ya no es cierto.
   */
  savedNotice?: ReactNode;
}

/**
 * Formulario del monotributo: categoría, tope anual en pesos y desde cuándo
 * rige. Los valores viven en el estado del formulario y se mandan a la acción
 * como un `FormData` común; la validación es del servidor. Como en los otros
 * formularios del panel, el envío se hace a mano y el botón espera a que la
 * página esté lista: así un clic temprano no se pierde y un error no borra lo
 * escrito. Al guardar, la acción redirige y la página pasa un `key` nuevo para
 * que el formulario vuelva a armarse con lo guardado.
 */
export function SettingsForm({ action, initialValues, footnote, children, savedNotice }: SettingsFormProps) {
  const [values, setValues] = useState(initialValues);
  const [state, dispatch, isSaving] = useActionState(action, INITIAL_SETTINGS_FORM_STATE);
  const [, startTransition] = useTransition();
  const [handledState, setHandledState] = useState(state);
  const [editedFields, setEditedFields] = useState<ReadonlySet<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);
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
    if (state === INITIAL_SETTINGS_FORM_STATE) return;
    const target =
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? summaryRef.current;
    target?.focus();
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  function update(patch: Partial<SettingsFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    setEditedFields((current) => new Set([...current, ...Object.keys(patch)]));
  }

  const headingId = "monotributo-heading";
  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={headingId}
      data-hydrated={hydrated ? "true" : "false"}
      className="border-2 border-ink bg-white"
    >
      {savedNotice && state === INITIAL_SETTINGS_FORM_STATE ? <Notice tone="ok">{savedNotice}</Notice> : null}
      <div ref={summaryRef} tabIndex={-1} className="outline-offset-0 empty:hidden">
        {state.formError ? (
          <Notice tone="error" className="border-l-8">
            {state.formError}
          </Notice>
        ) : null}
      </div>

      <div className="grid grid-cols-[13rem_minmax(0,1fr)] gap-x-10 gap-y-4 px-6 py-7 narrow:grid-cols-1 narrow:px-5 narrow:py-6">
        <div>
          <h2 id={headingId} className="text-[1.375rem] leading-tight font-extrabold [font-stretch:75%]">
            Monotributo
          </h2>
          <p className="mt-1 text-[0.875rem] leading-snug text-ink-2">
            Con estos datos el panel mide cuánto del tope anual llevás usado.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Field
            id="settings-category"
            label="Categoría"
            hint="La categoría en la que estás inscripto."
            error={errors.category}
          >
            {(control) => (
              <div className="max-w-[14rem]">
                <NativeSelect
                  {...control}
                  name="category"
                  value={values.category}
                  onChange={(event) => update({ category: event.target.value })}
                >
                  <NativeSelectOption value="">Elegí una</NativeSelectOption>
                  {MONOTRIBUTO_CATEGORIES.map((category) => (
                    <NativeSelectOption key={category} value={category}>
                      Categoría {category}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}
          </Field>
          <Field
            id="settings-cap"
            label="Tope anual en pesos"
            hint="El tope de facturación anual de esa categoría, copiado de la tabla. Con coma o punto para los centavos: 1.234.567,89."
            error={errors.annualCapArs}
          >
            {(control) => (
              <Input
                {...control}
                name="annualCapArs"
                inputMode="decimal"
                autoComplete="off"
                className="max-w-[20rem]"
                value={values.annualCapArs}
                onChange={(event) => update({ annualCapArs: event.target.value })}
              />
            )}
          </Field>
          <Field
            id="settings-valid-from"
            label="Vigente desde"
            hint="Desde cuándo rige ese tope, según la tabla."
            error={errors.validFrom}
          >
            {(control) => (
              <Input
                {...control}
                type="date"
                name="validFrom"
                className="max-w-[14rem]"
                value={values.validFrom}
                onChange={(event) => update({ validFrom: event.target.value })}
              />
            )}
          </Field>
          {children}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t-2 border-ink bg-paper px-6 py-4 narrow:px-5">
        <Button type="submit" disabled={!hydrated || isSaving}>
          {isSaving ? "Guardando…" : "Guardar configuración"}
        </Button>
        <NoScriptNote />
        <p className="text-[0.9375rem] text-ink-2">{footnote}</p>
      </div>
    </form>
  );
}
