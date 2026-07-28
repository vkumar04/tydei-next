"use client"

/**
 * Vendor Identity — the "also known as" list.
 *
 * Charles 2026-07-27: "In settings on the vendor side, I have a company name,
 * example Stryker. How does it know on the facility side what contract to pull
 * in when multiple names are used?" This tab is the answer's UI half: the
 * vendor declares the spellings their name appears under in facility files, and
 * `lib/vendors/resolve.ts` consults them (exact-on-normalized-key) before
 * falling back to fuzzy matching or minting a duplicate Vendor row.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Fingerprint, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { queryKeys } from "@/lib/query-keys"
import { vendorNameKey } from "@/lib/vendors/normalize"
import {
  addVendorAlias,
  listVendorAliases,
  removeVendorAlias,
  suggestVendorAliases,
} from "@/lib/actions/vendor-aliases"

export function IdentityTab({
  vendorId,
  vendorName,
}: {
  vendorId: string
  vendorName: string
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState("")

  const aliases = useQuery({
    queryKey: queryKeys.settings.vendorAliases(vendorId),
    queryFn: () => listVendorAliases(),
  })

  const suggestions = useQuery({
    queryKey: queryKeys.settings.vendorAliasSuggestions(vendorId),
    queryFn: () => suggestVendorAliases(),
  })

  // The suggestions key nests under the aliases key, so this one call refreshes
  // both — a newly added alias must drop out of the suggestion list.
  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: queryKeys.settings.vendorAliases(vendorId),
    })

  const add = useMutation({
    mutationFn: (alias: string) => addVendorAlias({ alias }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Could not add that alias.")
        return
      }
      setDraft("")
      toast.success(`"${res.alias?.alias}" added.`)
      void invalidate()
    },
    onError: () => toast.error("Could not add that alias."),
  })

  const remove = useMutation({
    mutationFn: (id: string) => removeVendorAlias(id),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? "Could not remove that alias.")
        return
      }
      void invalidate()
    },
    onError: () => toast.error("Could not remove that alias."),
  })

  const submit = () => {
    const value = draft.trim()
    if (!value) return
    add.mutate(value)
  }

  const rows = aliases.data ?? []
  // Same normalization the server uses, so the badge and the add-guard agree.
  const selfKey = vendorNameKey(vendorName)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4" />
          Also known as
        </CardTitle>
        <CardDescription>
          Facilities receive your data under whatever name their COG, purchase
          order and invoice files use — often a sales entity, a legal
          manufacturing entity, or an acquired brand rather than{" "}
          <span className="font-medium">{vendorName}</span>. List those spellings
          here and they will resolve to this workspace on import instead of
          creating a separate vendor with its own spend.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="e.g. Howmedica Osteonics"
            className="max-w-sm"
            aria-label="New alias"
          />
          <Button
            onClick={submit}
            disabled={!draft.trim() || add.isPending}
            className="gap-1.5"
          >
            {add.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Add alias
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Case, punctuation and corporate suffixes are ignored, so “
          {vendorName} Corp.”, “{vendorName.toUpperCase()} CORPORATION” and “
          {vendorName}, Inc” already resolve without an entry. Add the ones that
          genuinely differ — a sales entity, a subsidiary, or an acquired brand.
          An alias can belong to only one company.
        </p>

        {(suggestions.data?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-dashed p-3">
            <p className="mb-2 text-xs font-medium">Suggested</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.data?.map((s) => (
                <button
                  key={s.alias}
                  type="button"
                  title={s.reason}
                  disabled={add.isPending}
                  onClick={() => add.mutate(s.alias)}
                  className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" />
                  {s.alias}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Spellings that look like this company but resolve elsewhere today.
              Only add the ones that are genuinely yours — an alias moves spend.
            </p>
          </div>
        )}

        {aliases.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No aliases yet. If your spend looks split across duplicate vendor
            records on a facility&apos;s side, adding the other spelling here is
            the fix.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.alias}</p>
                  {/* An alias whose key equals the vendor's own name is a
                      no-op — resolution already handles it. Say so rather than
                      leaving it looking load-bearing: one of these ("Stryker
                      Corp") is what made adding "Stryker" fail with a confusing
                      message. Charles 2026-07-28. */}
                  {row.normalizedAlias === selfKey ? (
                    <p className="truncate text-xs text-amber-600">
                      Redundant — “{vendorName}” already resolves this. Safe to
                      remove.
                    </p>
                  ) : (
                    <p className="truncate text-xs text-muted-foreground">
                      matches as “{row.normalizedAlias}”
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {row.source !== "vendor" && (
                    <Badge variant="secondary" className="text-xs">
                      {row.source}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${row.alias}`}
                    onClick={() => remove.mutate(row.id)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
