import { TrendingUp, TrendingDown, Minus } from "lucide-react"

export function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
  if (trend === "down") return <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
  return <Minus className="h-4 w-4 text-muted-foreground" />
}
