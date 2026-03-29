"use client"

import Link from "next/link"
import { useState } from "react"
import { Menu, X, LayoutDashboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { useSession } from "@/lib/auth"

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { data: session } = useSession()
  const isLoggedIn = !!session?.user

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg">
            <span className="text-lg font-bold text-primary-foreground">T</span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold text-foreground">TYDEi</span>
            <span className="text-xs text-muted-foreground -mt-0.5">
              Healthcare Platform
            </span>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <ThemeToggle />
          {isLoggedIn ? (
            <Button size="sm" asChild>
              <Link href="/dashboard">
                <LayoutDashboard className="mr-2 size-4" />
                Dashboard
              </Link>
            </Button>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Sign In
                </Button>
              </Link>
              <Link href="/sign-up">
                <Button size="sm">Get Started</Button>
              </Link>
            </>
          )}
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
        <div className="border-t bg-background/95 backdrop-blur-lg md:hidden">
          <div className="flex flex-col gap-2 px-4 py-4">
            <div className="flex items-center gap-2 pt-2">
              <ThemeToggle />
              {isLoggedIn ? (
                <Button size="sm" asChild className="flex-1">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" asChild className="flex-1">
                    <Link href="/login">Sign In</Link>
                  </Button>
                  <Button size="sm" asChild className="flex-1">
                    <Link href="/sign-up">Get Started</Link>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
