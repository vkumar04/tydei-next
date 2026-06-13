"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

/**
 * Measures its own box and hands explicit pixel width/height to a recharts
 * chart — a drop-in replacement for `ResponsiveContainer` that never logs
 * the "width(-1) and height(-1) of chart should be greater than 0" warning.
 *
 * 2026-06-13 caveat fix: the contract-detail Performance tab is a Radix
 * `TabsContent` that mounts on activation. `ResponsiveContainer` always does
 * a first internal render at -1×-1 before its ResizeObserver measures, and
 * logs that warning when the initial measurement is 0 (which it is inside a
 * just-activated tab). Gating ResponsiveContainer behind a measured parent
 * did NOT help — recharts warns on its own first pass. Passing concrete
 * `width`/`height` to the chart (e.g. `<AreaChart width={w} height={h}>`)
 * sidesteps measurement entirely, so the warning never fires. Rendered
 * output is identical; we just own the ResizeObserver instead of recharts.
 *
 * Usage:
 *   <ChartFrame className="h-72">
 *     {({ width, height }) => (
 *       <AreaChart width={width} height={height} data={data}>…</AreaChart>
 *     )}
 *   </ChartFrame>
 */
export function ChartFrame({
  children,
  className = "h-full w-full",
}: {
  children: (size: { width: number; height: number }) => ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (w: number, h: number) => {
      if (w > 0 && h > 0) {
        setSize((prev) =>
          prev && prev.width === w && prev.height === h ? prev : { width: w, height: h },
        )
      }
    }
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) apply(Math.round(box.width), Math.round(box.height))
    })
    ro.observe(el)
    apply(el.clientWidth, el.clientHeight)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={ref} className={className}>
      {size ? children(size) : null}
    </div>
  )
}
