"use client"

/**
 * `useAlertMutation` is now a thin alias of the generalized
 * {@link useToastMutation} factory (`hooks/use-toast-mutation.ts`). The alert
 * hooks (`use-alerts.ts`, `use-vendor-alerts.ts`) were the original callers of
 * this shape (invalidate keys → success/error toast); the factory was lifted
 * out so the rest of the repo's mutation hooks share it. The signatures are
 * identical, so the alert call sites are untouched — they keep passing
 * `{ invalidate, success?, error? }`, the silent mark-read stays silent
 * (no `success`/`error`), and `success` may still be a `(data) => string` fn.
 */
export { useToastMutation as useAlertMutation } from "@/hooks/use-toast-mutation"
