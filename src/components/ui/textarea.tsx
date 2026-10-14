import * as React from "react"
import { cn } from "cn"
import { fieldClasses } from "@/components/ui/input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn("min-h-24 py-2 leading-snug", fieldClasses, className)}
      {...props}
    />
  )
}

export { Textarea }
