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
import {
  addVendorAlias,
  listVendorAliases,
  removeVendorAlias,
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
          Case, punctuation and corporate suffixes are ignored, so “Stryker
          Corp.”, “STRYKER CORPORATION” and “Stryker, Inc” already resolve
          without an entry. Add the ones that genuinely differ — a sales entity,
          a subsidiary, or an acquired brand. An alias can belong to only one
          company.
        </p>

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
                  <p className="truncate text-xs text-muted-foreground">
                    matches as “{row.normalizedAlias}”
                  </p>
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
