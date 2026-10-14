"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps extends Omit<ComponentProps<typeof Button>, "type" | "children"> {
  children: string;
  /** Texto mientras el formulario se envía. */
  pendingLabel: string;
}

/** Botón de envío que se desactiva y cambia de texto mientras la acción corre. */
export function SubmitButton({ children, pendingLabel, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
