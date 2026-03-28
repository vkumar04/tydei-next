import type { ReactNode } from "react"

interface TableFiltersProps {
  children: ReactNode
}

export function TableFilters({ children }: TableFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  )
}
