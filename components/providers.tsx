"use client"

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { ThemeProvider } from "next-themes"
import { toast, Toaster } from "sonner"
import { useState } from "react"

/**
 * Charles 2026-04-30: when the deployed/built server action manifest
 * is newer than the client bundle the user has loaded, every mutation
 * (or query) hitting that action fails with:
 *
 *   "Server Action 'XXXXX' was not found on the server. Read more:
 *    https://nextjs.org/docs/messages/failed-to-find-server-action"
 *
 * Hard-refresh sometimes doesn't break the cache (browser may serve
 * the old HTML's chunk references). Detect the message and surface
 * a clearer recovery action — single toast with a Reload button —
 * instead of letting individual mutations show the cryptic Next.js
 * message.
 */
const STALE_ACTION_RE = /server action.*was not found on the server/i

let staleActionToastShown = false
function handleStaleAction(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (!STALE_ACTION_RE.test(msg)) return false
  if (staleActionToastShown) return true
  staleActionToastShown = true
  toast.error("App was updated — reload to continue", {
    description:
      "Your browser is running an older version. Reload to pick up the latest server actions.",
    duration: Infinity,
    action: {
      label: "Reload",
      onClick: () => {
        // Cache-busting query param forces the HTML to re-fetch even
        // if the disk cache wants to short-circuit.
        const url = new URL(window.location.href)
        url.searchParams.set("_v", String(Date.now()))
        window.location.replace(url.toString())
      },
    },
  })
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
