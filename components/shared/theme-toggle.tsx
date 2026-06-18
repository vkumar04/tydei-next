"use client"

import { Moon, Sun, Monitor, ChevronDown, Check } from "lucide-react"
import { useTheme } from "next-themes"
import { useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type Origin = { x: number; y: number }

/**
 * Set the theme with a circular "sweep" reveal of the new theme expanding from
 * `origin`, using the View Transitions API. Falls back to an instant switch
 * where the API is unavailable (Firefox/older Safari) or the user prefers
 * reduced motion. (2026-06-18 — replaced the plain dropdown toggle.)
 */
function setThemeWithReveal(
  setTheme: (t: string) => void,
  value: string,
  origin?: Origin,
) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void> }
  }
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  if (!doc.startViewTransition || reduceMotion || !origin) {
    setTheme(value)
    return
  }

  const { x, y } = origin
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
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const buttonRef = useRef<HTMLButtonElement>(null)

  const originFromButton = (): Origin | undefined => {
    const r = buttonRef.current?.getBoundingClientRect()
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined
  }

  const toggle = useCallback(() => {
    setThemeWithReveal(
      setTheme,
      resolvedTheme === "dark" ? "light" : "dark",
      originFromButton(),
    )
  }, [resolvedTheme, setTheme])

  return (
    <div className="inline-flex items-center">
      {/* Primary: one-click light⇄dark with the circular reveal. */}
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        className="size-8 rounded-r-none"
        onClick={toggle}
        aria-label="Toggle light or dark theme"
        title="Toggle theme"
      >
        <Sun className="size-4 rotate-0 scale-100 transition-all duration-500 dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute size-4 rotate-90 scale-0 transition-all duration-500 dark:rotate-0 dark:scale-100" />
      </Button>

      {/* Secondary: full Light / Dark / System choice. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 w-5 rounded-l-none px-0 text-muted-foreground"
            aria-label="Theme options"
          >
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <ThemeItem
            label="Light"
            value="light"
            active={theme === "light"}
            icon={<Sun className="mr-2 size-4" />}
            onSelect={(e) =>
              setThemeWithReveal(setTheme, "light", { x: e.clientX, y: e.clientY })
            }
          />
          <ThemeItem
            label="Dark"
            value="dark"
            active={theme === "dark"}
            icon={<Moon className="mr-2 size-4" />}
            onSelect={(e) =>
              setThemeWithReveal(setTheme, "dark", { x: e.clientX, y: e.clientY })
            }
          />
          <ThemeItem
            label="System"
            value="system"
            active={theme === "system"}
            icon={<Monitor className="mr-2 size-4" />}
            onSelect={() => setTheme("system")}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ThemeItem({
  label,
  active,
  icon,
  onSelect,
}: {
  label: string
  value: string
  active: boolean
  icon: React.ReactNode
  onSelect: (e: React.MouseEvent) => void
}) {
  return (
    <DropdownMenuItem onClick={onSelect}>
      {icon}
      <span className="flex-1">{label}</span>
      <Check className={cn("ml-2 size-4", active ? "opacity-100" : "opacity-0")} />
    </DropdownMenuItem>
  )
}
