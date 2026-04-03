import { Badge } from "@/components/ui/badge"

interface ScoreBadgeProps {
  score: number | null | undefined
  size?: "sm" | "md"
}

function getGrade(score: number): { letter: string; className: string } {
  if (score >= 80)
    return {
      letter: "A",
      className:
        "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400",
    }
  if (score >= 60)
    return {
      letter: "B",
      className:
        "bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
    }
  if (score >= 40)
    return {
      letter: "C",
      className:
        "bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400",
    }
  if (score >= 20)
    return {
      letter: "D",
      className:
        "bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400",
    }
  return {
    letter: "F",
    className:
      "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400",
  }
}

export function ScoreBadge({ score, size = "sm" }: ScoreBadgeProps) {
  if (score == null) return null

  const { letter, className } = getGrade(score)

  return (
    <Badge
      variant="secondary"
      className={`${className} ${size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs"}`}
    >
      {letter}
    </Badge>
  )
}
