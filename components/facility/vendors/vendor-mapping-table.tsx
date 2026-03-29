"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Trash2 } from "lucide-react"
import { queryKeys } from "@/lib/query-keys"
import {
  getVendorNameMappings,
  confirmVendorNameMapping,
  deleteVendorNameMapping,
} from "@/lib/actions/vendor-mappings"
import { getVendors } from "@/lib/actions/vendors"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"

export function VendorMappingTable() {
  const qc = useQueryClient()
  const [selections, setSelections] = useState<Record<string, string>>({})

  const { data } = useQuery({
    queryKey: queryKeys.vendors.mappings(),
    queryFn: () => getVendorNameMappings({ isConfirmed: false }),
  })

  const { data: vendors } = useQuery({
    queryKey: queryKeys.vendors.all,
    queryFn: () => getVendors(),
  })

  const confirmMutation = useMutation({
    mutationFn: ({ id, vendorId }: { id: string; vendorId: string }) =>
      confirmVendorNameMapping(id, vendorId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vendors.mappings() })
      toast.success("Mapping confirmed")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteVendorNameMapping,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vendors.mappings() })
      toast.success("Mapping deleted")
    },
  })

  const mappings = data?.mappings ?? []

  if (mappings.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No unconfirmed vendor name mappings.
      </p>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>COG Vendor Name</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Map To</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mappings.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.cogVendorName}</TableCell>
              <TableCell>
                {m.confidenceScore ? (
                  <Badge variant="secondary">
                    {Number(m.confidenceScore)}%
                  </Badge>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={selections[m.id] ?? m.mappedVendorId ?? ""}
                  onValueChange={(v) =>
                    setSelections((prev) => ({ ...prev, [m.id]: v }))
                  }
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select vendor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors?.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={!selections[m.id]}
                    onClick={() =>
                      confirmMutation.mutate({
                        id: m.id,
                        vendorId: selections[m.id]!,
                      })
                    }
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(m.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
