import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/**
 * Insignia de estado, adaptada a la marca: esquinas de 4 px y colores con
 * significado (cobrada = verde, entregada = azul, pendiente = dorado,
 * reembolsada = rojo). El texto de cada tono contrasta 7:1 o más sobre su fondo.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-[4px] px-2 py-0.5 text-[0.8125rem] leading-5 font-bold whitespace-nowrap",
  {
    variants: {
      variant: {
        neutral: "bg-neutral-tint text-ink",
        ok: "bg-ok-tint text-ok-ink",
        info: "bg-info-tint text-info-ink",
        warn: "bg-warn-tint text-warn-ink",
        danger: "bg-danger-tint text-danger-ink",
        outline: "border border-ink-2 text-ink",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Badge({
  className,
  variant = "neutral",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
