"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

/**
 * Defers rendering a recharts chart until its frame has a non-zero measured
 * size.
 *
 * 2026-06-13 caveat fix: the contract-detail Performance tab is a Radix
 * `TabsContent` that mounts on activation. recharts `ResponsiveContainer`
 * attaches a ResizeObserver that fires ONCE at 0×0 during that first
 * layout pass — before the panel's height resolves — and logs
 * "The width(-1) and height(-1) of chart should be greater than 0". The
 * chart then measures correctly and renders, so it was only console noise,
 * but noise that masks real warnings.
 *
 * Gating the children behind a measured size means `ResponsiveContainer`
 * never mounts into a 0×0 box, so the warning never fires. Rendered output
 * is unchanged. Reusable across every contract chart (Monthly Spend,
 * Rebate by Quarter, Rebate Forecast).
 */
export function ChartFrame({
  children,
  className = "h-full w-full",
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Already laid out at mount (direct nav, re-activation) — render now.
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      setReady(true)
      return
    }
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box && box.width > 0 && box.height > 0) setReady(true)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className={className}>
      {ready ? children : null}
    </div>
  )
}
