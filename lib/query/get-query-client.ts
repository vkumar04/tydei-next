import {
  QueryClient,
  defaultShouldDehydrateQuery,
  isServer,
} from "@tanstack/react-query"

// Per the TanStack App Router guide — the server gets a fresh
// QueryClient per request (no module-level singleton, or one request
// would leak into the next); the browser reuses a single client
// across navigations so prefetched state survives.
// https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Mirror Providers (`components/providers.tsx`) so server-side
        // prefetched data inherits the same freshness rules.
        staleTime: 60_000,
        gcTime: 10 * 60_000,
      },
      dehydrate: {
        // Include pending queries so server-streamed `prefetchQuery`
        // calls actually transport their state into the client.
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient()
  return (browserQueryClient ??= makeQueryClient())
}
