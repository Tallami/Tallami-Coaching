"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface PayButtonProps {
  label: string;
  pendingLabel: string;
}

/** El botón de pagar. Mientras se arma el pago dice que va en camino y no deja tocarlo de nuevo: cada envío es un pedido. */
export function PayButton({ label, pendingLabel }: PayButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className="mt-6 w-full">
      {pending ? pendingLabel : label}
    </Button>
  );
}
