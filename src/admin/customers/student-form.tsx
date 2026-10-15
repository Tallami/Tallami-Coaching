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
} from "react";
import {
  INITIAL_STUDENT_FORM_STATE,
  type StudentFormState,
  type StudentFormValues,
} from "@/admin/customers/form-state";
import {
  COUNTRY_CODE_LENGTH,
  MAX_DISCORD_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from "@/admin/customers/schema";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface StudentFormProps {
  mode: "create" | "edit";
  /** La acción que guarda; ante un problema devuelve el estado con los errores. */
  action: (state: StudentFormState, formData: FormData) => Promise<StudentFormState>;
  initialValues: StudentFormValues;
  /** A dónde lleva "Cancelar". */
  cancelHref: string;
}

// Un snapshot que siempre es `true` en el navegador y `false` al renderizar en
// el servidor: dice si la página ya está lista para usarse.
const subscribeNever = () => () => {};
const isHydrated = () => true;
const isNotHydrated = () => false;

/**
 * Formulario de alta y edición de un alumno. Los valores viven en el estado del
 * formulario y se mandan a la acción como un `FormData` común; la validación es
 * del servidor. Como en el formulario de ventas, el envío se hace a mano y el
 * botón de guardar espera a que la página esté lista: así un clic temprano no
 * se pierde y un error no borra lo escrito.
 *
 * Los valores iniciales se leen una sola vez: si el servidor los normaliza al
 * guardar (el país en mayúsculas), la página pasa un `key` nuevo para que el
 * formulario vuelva a armarse con lo guardado.
 */
export function StudentForm({ mode, action, initialValues, cancelHref }: StudentFormProps) {
  const [values, setValues] = useState(initialValues);
  const [state, dispatch, isSaving] = useActionState(action, INITIAL_STUDENT_FORM_STATE);
  const [, startTransition] = useTransition();
  const [handledState, setHandledState] = useState(state);
  const [editedFields, setEditedFields] = useState<ReadonlySet<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(subscribeNever, isHydrated, isNotHydrated);

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
    if (state === INITIAL_STUDENT_FORM_STATE) return;
    const target =
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? summaryRef.current;
    target?.focus();
  }, [state]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  function update(patch: Partial<StudentFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    setEditedFields((current) => new Set([...current, ...Object.keys(patch)]));
  }

  const headingId = "student-form-heading";
  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby={headingId}
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

      <div className="flex flex-col gap-5 px-5 py-5">
        <h2 id={headingId} className="text-[1.375rem] leading-tight font-extrabold [font-stretch:75%]">
          Datos del alumno
        </h2>
        <Field id="student-name" label="Nombre" error={errors.name}>
          {(control) => (
            <Input
              {...control}
              name="name"
              autoComplete="off"
              maxLength={MAX_NAME_LENGTH}
              value={values.name}
              onChange={(event) => update({ name: event.target.value })}
            />
          )}
        </Field>
        <Field id="student-discord" label="Discord" optional error={errors.discord}>
          {(control) => (
            <Input
              {...control}
              name="discord"
              autoComplete="off"
              maxLength={MAX_DISCORD_LENGTH}
              value={values.discord}
              onChange={(event) => update({ discord: event.target.value })}
            />
          )}
        </Field>
        <Field
          id="student-country"
          label="País"
          optional
          hint="2 letras: AR, BR, MX."
          error={errors.country}
        >
          {(control) => (
            <Input
              {...control}
              name="country"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={COUNTRY_CODE_LENGTH}
              className="uppercase"
              value={values.country}
              onChange={(event) => update({ country: event.target.value })}
            />
          )}
        </Field>
        <Field id="student-notes" label="Notas" optional error={errors.notes}>
          {(control) => (
            <Textarea
              {...control}
              name="notes"
              maxLength={MAX_NOTES_LENGTH}
              value={values.notes}
              onChange={(event) => update({ notes: event.target.value })}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t-2 border-ink bg-paper px-5 py-4">
        <Button type="submit" disabled={!hydrated || isSaving}>
          {isSaving ? "Guardando…" : mode === "create" ? "Guardar alumno" : "Guardar cambios"}
        </Button>
        <Button asChild variant="ink-outline">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
