import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Download, FileSpreadsheet, Plus } from "lucide-react"

export interface POFilterBarProps {
  statusFilter: string
  onStatusFilterChange: (value: string) => void
  onExportCSV: () => void
  onAddPO: () => void
}

export function POFilterBar({
  statusFilter,
  onStatusFilterChange,
  onExportCSV,
  onAddPO,
}: POFilterBarProps) {
  return (
    <Tabs value={statusFilter} onValueChange={onStatusFilterChange}>
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="shipped">Shipped</TabsTrigger>
          <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
        </TabsList>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onExportCSV}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={onAddPO} className="gap-2">
            <Plus className="h-4 w-4" />
            Add PO
          </Button>
        </div>
      </div>
    </Tabs>
  )
}
