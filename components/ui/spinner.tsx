import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- canonical shadcn Spinner: role="status"+aria-label on the spinning icon; <output> is for form-result text, not an icon-only loader.
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
