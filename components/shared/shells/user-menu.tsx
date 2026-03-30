"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { LogOut, Settings, ChevronDown } from "lucide-react"
import { authClient } from "@/lib/auth"
import type { PortalRole } from "@/lib/types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface UserMenuProps {
  user: { name: string; email: string; image?: string | null }
  role?: PortalRole
}

export function UserMenu({ user, role }: UserMenuProps) {
  const router = useRouter()

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  const settingsHref =
    role === "vendor"
      ? "/vendor/settings"
      : role === "admin"
        ? "/admin/settings"
        : "/dashboard/settings"

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/login")
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 px-2 text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col items-start text-left">
            <span className="text-sm font-medium truncate max-w-[120px]">
              {user.name}
            </span>
            <span className="text-xs text-sidebar-foreground/70 truncate max-w-[120px]">
              {user.email}
            </span>
          </div>
          <ChevronDown className="h-4 w-4 text-sidebar-foreground/70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={settingsHref}>
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
