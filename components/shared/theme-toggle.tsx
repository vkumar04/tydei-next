"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"

/**
 * One-click light⇄dark toggle. Clicking sweeps the new theme across the page as
 * an expanding circle from the button (View Transitions API), with a sun⇄moon
 * morph. Falls back to an instant switch where the API is unavailable
 * (Firefox/older Safari) or the user prefers reduced motion. (2026-06-18 —
 * replaced the dropdown toggle; System option removed per request.)
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const buttonRef = useRef<HTMLButtonElement>(null)

  const toggle = useCallback(() => {
    const value = resolvedTheme === "dark" ? "light" : "dark"
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> }
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const rect = buttonRef.current?.getBoundingClientRect()

    if (!doc.startViewTransition || reduceMotion || !rect) {
      setTheme(value)
      return
    }

    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )

    const transition = doc.startViewTransition(() => setTheme(value))
    transition.ready.then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 480,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      )
    })
  }, [resolvedTheme, setTheme])

  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={toggle}
      aria-label="Toggle light or dark theme"
      title="Toggle theme"
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all duration-500 dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all duration-500 dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
