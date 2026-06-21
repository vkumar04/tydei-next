/**
 * Tone → Tailwind color ladder shared by every HeroStat (and a few non-hero
 * cards). One pure module so the 21+ copies can't drift on the class strings.
 *
 * The exact class strings here are what the existing hero copies already use —
 * keep them identical so migration is visually a no-op.
 */

export type Tone = "positive" | "negative" | "warning" | "muted"

/** Big-number text color. */
export function toneValueClass(tone: Tone): string {
  switch (tone) {
    case "positive":
      return "text-emerald-600 dark:text-emerald-400"
    case "negative":
      return "text-red-600 dark:text-red-400"
    case "warning":
      return "text-amber-600 dark:text-amber-400"
    case "muted":
      return ""
  }
}

/** Sublabel text color. */
export function toneSublabelClass(tone: Tone): string {
  switch (tone) {
    case "positive":
      return "text-emerald-700 dark:text-emerald-400"
    case "negative":
      return "text-red-700 dark:text-red-400"
    case "warning":
      return "text-amber-700 dark:text-amber-400"
    case "muted":
      return "text-muted-foreground"
  }
}
