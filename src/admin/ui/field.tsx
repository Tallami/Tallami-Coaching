import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Lo que el campo (input, select, textarea) tiene que recibir para quedar bien enlazado. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

interface FieldProps {
  id: string;
  label: string;
  /** Marca el campo como no obligatorio. Los demás se entienden obligatorios. */
  optional?: boolean;
  /** Ayuda corta debajo del campo. */
  hint?: ReactNode;
  /** El error del campo, ya en español. */
  error?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Un campo de formulario: etiqueta, control, ayuda y error. El control se
 * arma con una función para recibir su `id` y los `aria-*` que lo enlazan con
 * la ayuda y el error:
 *
 *   <Field id="amount" label="Monto" error={errors.amount}>
 *     {(control) => <Input {...control} name="amount" />}
 *   </Field>
 */
export function Field({ id, label, optional, hint, error, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        <span>
          {label}
          {optional ? <span className="font-normal text-ink-2"> (opcional)</span> : null}
        </span>
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-[0.875rem] leading-snug text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[0.9375rem] leading-snug font-bold text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
