"use client"

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { toast, Toaster } from "sonner"
import { useEffect, useState } from "react"

/**
 * Charles 2026-04-30 / 2026-06-17: when the deployed server-action manifest
 * is newer than the client bundle the user has loaded, every mutation, query,
 * direct action call, or form action hitting that action fails with a
 * deployment-skew error. Next.js has used two wordings:
 *
 *   (legacy) "Server Action 'XXXXX' was not found on the server."
 *   (current) "Failed to find Server Action 'XXXXX'. This request might be
 *              from an older or newer deployment."
 *
 * Both always link to nextjs.org/docs/messages/failed-to-find-server-action.
 * The old regex only matched the legacy wording, so the current message slipped
 * through and surfaced raw to users. Match every variant, then auto-reload the
 * page (cache-busted) so the user silently picks up the latest build. A
 * sessionStorage loop-guard prevents an infinite reload when the error keeps
 * firing post-reload (e.g. the action's own code changed across deploys, which
 * no stable encryption key can paper over) — in that case we fall back to a
 * single manual "Reload" toast.
 */
export function isStaleActionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /failed to find server action|server action .*was not found on the server|this request might be from an older or newer deployment|failed-to-find-server-action/i.test(
    msg,
  )
}

const RELOAD_GUARD_KEY = "tydei_stale_action_reload_at"
const RELOAD_GUARD_MS = 20_000
let handledThisSession = false

function reloadWithCacheBust() {
  // Cache-busting query param forces the HTML to re-fetch even if the disk
  // cache wants to short-circuit to the stale chunk references.
  const url = new URL(window.location.href)
  url.searchParams.set("_v", String(Date.now()))
  window.location.replace(url.toString())
}

function showReloadToast() {
  toast.error("App was updated — reload to continue", {
    description:
      "Your browser is running an older version. Reload to pick up the latest server actions.",
    duration: Infinity,
    action: { label: "Reload", onClick: reloadWithCacheBust },
  })
}

function handleStaleAction(err: unknown): boolean {
  if (!isStaleActionError(err)) return false
  if (handledThisSession) return true
  handledThisSession = true

  let last = 0
  try {
    last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
  } catch {
    // sessionStorage unavailable (private mode / SSR) — fall through to reload.
  }
  const now = Date.now()
  if (now - last < RELOAD_GUARD_MS) {
    // We auto-reloaded moments ago and it's STILL failing — stop looping.
    showReloadToast()
    return true
  }
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(now))
  } catch {
    // ignore
  }
  reloadWithCacheBust()
  return true
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 10 * 60_000,
          },
        },
        queryCache: new QueryCache({
          onError: (err) => handleStaleAction(err),
        }),
        mutationCache: new MutationCache({
          onError: (err) => handleStaleAction(err),
        }),
      })
  )

  // Catch the deployment-skew error on the paths TanStack doesn't see —
  // direct server-action calls, form actions, and other rejected promises.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => handleStaleAction(e.reason)
    const onError = (e: ErrorEvent) => handleStaleAction(e.error ?? e.message)
    window.addEventListener("unhandledrejection", onRejection)
    window.addEventListener("error", onError)
    return () => {
      window.removeEventListener("unhandledrejection", onRejection)
      window.removeEventListener("error", onError)
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster position="top-right" richColors />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
