"use client"

import Link from "next/link"
import { useState } from "react"
import { Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/shared/theme-toggle"

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "About", href: "#about" },
]

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <span className="text-sm font-bold text-primary-foreground">T</span>
          </div>
          <span className="text-lg font-bold">TYDEi</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/login">Sign In</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/sign-up">Get Started</Link>
          </Button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border/50 bg-background/95 backdrop-blur-lg md:hidden">
          <div className="flex flex-col gap-2 px-4 py-4">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="flex items-center gap-2 pt-2">
              <ThemeToggle />
              <Button variant="ghost" size="sm" asChild className="flex-1">
                <Link href="/login">Sign In</Link>
              </Button>
              <Button size="sm" asChild className="flex-1">
                <Link href="/sign-up">Get Started</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
