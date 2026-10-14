import * as React from "react"
import { cn } from "cn"

/** Clases del borde y el fondo que comparten los campos de texto del panel. */
const fieldClasses =
  "w-full min-w-0 rounded-[4px] border border-ink-2 bg-white px-3 text-[1rem] text-ink transition-[color,background-color,border-color] duration-150 placeholder:text-ink-2 hover:border-ink focus-visible:border-zone disabled:cursor-not-allowed disabled:bg-neutral-tint disabled:opacity-60 aria-invalid:border-2 aria-invalid:border-danger aria-invalid:bg-danger-tint/40"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn("min-h-11", fieldClasses, className)}
      {...props}
    />
  )
}

export { Input, fieldClasses }
