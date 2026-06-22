"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileBarChart, FileText, Sheet } from "lucide-react"
import type { ReportType } from "./reports-types"

export interface ReportTypeGridProps {
  reportTypes: ReportType[]
  onGenerate: (report: ReportType, format: "pdf" | "csv") => void
}

/**
 * Grid of report-type "generate" cards. Clicking a card's button
 * opens the generate dialog for that type.
 */
export function ReportTypeGrid({ reportTypes, onGenerate }: ReportTypeGridProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {reportTypes.map((report) => (
        <Card key={report.id} className="hover:bg-accent/50 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <report.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm">{report.name}</CardTitle>
                <Badge variant="outline" className="text-xs mt-1">
                  {report.frequency}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              {report.description}
            </p>
            {report.id === "leakage" ? (
              // Leakage has no tabular export — the button scrolls to its
              // live audit card (handled in the parent).
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onGenerate(report, "pdf")
                }}
              >
                <FileBarChart className="h-4 w-4 mr-2" />
                View audit
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" className="w-full">
                    <FileBarChart className="h-4 w-4 mr-2" />
                    Generate Report
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  <DropdownMenuItem onSelect={() => onGenerate(report, "pdf")}>
                    <FileText className="h-4 w-4 mr-2" />
                    Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onGenerate(report, "csv")}>
                    <Sheet className="h-4 w-4 mr-2" />
                    Download CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
