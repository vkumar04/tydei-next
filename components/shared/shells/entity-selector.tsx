"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface EntitySelectorProps {
  entities: { id: string; name: string }[]
  selectedId: string
  onSelect: (id: string) => void
  label: string
}

export function EntitySelector({
  entities,
  selectedId,
  onSelect,
  label,
}: EntitySelectorProps) {
  return (
    <Select value={selectedId} onValueChange={onSelect}>
      <SelectTrigger className="w-full bg-sidebar-accent text-sidebar-accent-foreground">
        <SelectValue placeholder={`Select ${label}`} />
      </SelectTrigger>
      <SelectContent>
        {entities.map((entity) => (
          <SelectItem key={entity.id} value={entity.id}>
            {entity.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
