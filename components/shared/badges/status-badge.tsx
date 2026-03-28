import type { StatusConfig } from "@/lib/types"
import { Badge } from "@/components/ui/badge"

interface StatusBadgeProps {
  status: string
  config: Record<string, StatusConfig>
}

export function StatusBadge({ status, config }: StatusBadgeProps) {
  const cfg = config[status]
  if (!cfg) return <Badge variant="outline">{status}</Badge>

  return (
    <Badge variant={cfg.variant} className={cfg.className}>
      {cfg.label}
    </Badge>
  )
}
