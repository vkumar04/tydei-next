/**
 * Shared HeroStat — one panel inside a hero banner's `border-y py-6` stat grid.
 *
 * Superset of all ~21 local copies that previously lived inline in each
 * `*-hero.tsx` / hero client. Pure presentational; no client hooks, so it can
 * render inside both server and client components.
 *
 * Markup is byte-identical to the prior copies:
 *   - `space-y-1` block
 *   - `text-[11px] uppercase tracking-wider text-muted-foreground` label row,
 *     with an optional leading icon (`flex items-center gap-1.5`)
 *   - `text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl` value,
 *     colored by `toneValueClass(tone)`; renders `value ?? "—"`. When `value`
 *     is `null` and a `skeleton` node is supplied, the skeleton renders in
 *     place of the value (the loading state several hero copies used).
 *   - `text-xs` sublabel, colored by `toneSublabelClass(tone)`
 */

import type * as React from "react"

import { toneSublabelClass, toneValueClass, type Tone } from "@/lib/ui/tone-colors"

export interface HeroStatProps {
  label: string
  value: string | null
  sublabel?: string
  tone?: Tone
  icon?: React.ReactNode
  /** Rendered in place of the value while `value` is `null` (loading state). */
  skeleton?: React.ReactNode
}

export function HeroStat({
  label,
  value,
  sublabel,
  tone = "muted",
  icon,
  skeleton,
}: HeroStatProps) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      {value === null && skeleton !== undefined ? (
        skeleton
      ) : (
        <p
          className={`text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl ${toneValueClass(
            tone,
          )}`}
        >
          {value ?? "—"}
        </p>
      )}
      {sublabel !== undefined && (
        <p className={`text-xs ${toneSublabelClass(tone)}`}>{sublabel}</p>
      )}
    </div>
  )
}
