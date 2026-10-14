import * as React from "react"
import { cn } from "cn"
import { ChevronDownIcon } from "lucide-react"
import { fieldClasses } from "@/components/ui/input"

type NativeSelectProps = React.ComponentProps<"select">

/**
 * Lista desplegable del sistema: en el celular abre el selector del teléfono y
 * funciona sin JavaScript. Lleva el mismo borde y foco que los demás campos.
 */
function NativeSelect({ className, ...props }: NativeSelectProps) {
  return (
    <div
      className="group/native-select relative w-full has-[select:disabled]:opacity-60"
      data-slot="native-select-wrapper"
    >
      <select
        data-slot="native-select"
        className={cn("min-h-11 appearance-none py-1 pr-9", fieldClasses, className)}
        {...props}
      />
      <ChevronDownIcon
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-2"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-white text-ink", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-white text-ink", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
