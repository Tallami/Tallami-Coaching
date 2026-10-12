import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-2 border-transparent text-center font-bold transition-colors duration-150 ease-in-out disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        gold: "bg-gold text-stage hover:bg-gold-hover",
        "stage-outline":
          "border-[#7F8BB5] text-on-stage hover:border-on-stage",
        "ink-outline":
          "border-ink text-ink hover:bg-ink hover:text-paper",
      },
      size: {
        default: "min-h-12 px-[22px]",
        sm: "min-h-11 px-4 text-[.95rem]",
      },
    },
    defaultVariants: {
      variant: "gold",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "gold",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
