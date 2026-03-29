"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  FileText,
  Download,
  Calendar,
  BarChart3,
  TrendingUp,
  DollarSign,
  CheckCircle2,
  FileBarChart,
  Building2,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency } from "@/lib/formatting"
import type { ColumnDef } from "@tanstack/react-table"
import { getVendorReportData, type VendorContractReport } from "@/lib/actions/vendor-reports"

const performanceColumns: ColumnDef<VendorContractReport>[] = [
  { accessorKey: "name", header: "Contract" },
  { accessorKey: "facilityName", header: "Facility" },
  { accessorKey: "totalSpend", header: "Total Spend", cell: ({ row }) => formatCurrency(row.original.totalSpend) },
  { accessorKey: "rebateEarned", header: "Rebate Earned", cell: ({ row }) => formatCurrency(row.original.rebateEarned) },
  { accessorKey: "status", header: "Status" },
]

const reportTypes = [
  {
    id: "performance",
    name: "Performance Summary",
    description: "Contract performance metrics and compliance",
    icon: TrendingUp,
    frequency: "Monthly",
  },
  {
    id: "rebates",
    name: "Rebate Statement",
    description: "Rebates earned and paid by contract",
    icon: DollarSign,
    frequency: "Quarterly",
  },
  {
    id: "spend",
    name: "Spend Analysis",
    description: "Spend breakdown by facility and category",
    icon: BarChart3,
    frequency: "Monthly",
  },
  {
    id: "compliance",
    name: "Compliance Report",
    description: "Contract compliance and tier achievement",
    icon: CheckCircle2,
    frequency: "Quarterly",
  },
]

interface RecentReport {
  id: string
  name: string
  type: string
  date: string
  status: string
  size: string
}

const defaultRecentReports: RecentReport[] = [
  { id: "1", name: "Q1 2024 Performance Summary", type: "performance", date: "2024-04-05", status: "ready", size: "2.4 MB" },
  { id: "2", name: "Q1 2024 Rebate Statement", type: "rebates", date: "2024-04-02", status: "ready", size: "1.8 MB" },
  { id: "3", name: "March 2024 Spend Analysis", type: "spend", date: "2024-04-01", status: "ready", size: "3.1 MB" },
  { id: "4", name: "February 2024 Spend Analysis", type: "spend", date: "2024-03-01", status: "ready", size: "2.9 MB" },
  { id: "5", name: "Q4 2023 Compliance Report", type: "compliance", date: "2024-01-15", status: "ready", size: "1.5 MB" },
]

interface VendorReportsClientProps {
  vendorId: string
}

export function VendorReportsClient({ vendorId }: VendorReportsClientProps) {
  const [selectedFacility, setSelectedFacility] = useState("all")
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false)
  const [selectedReportType, setSelectedReportType] = useState<typeof reportTypes[0] | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateProgress, setGenerateProgress] = useState(0)
  const [reportPeriod, setReportPeriod] = useState("current")
  const [generatedReports, setGeneratedReports] = useState<RecentReport[]>(defaultRecentReports)

  const { data, isLoading } = useQuery({
    queryKey: ["vendorReports", vendorId],
    queryFn: () => getVendorReportData(vendorId),
  })

  const handleGenerateReport = (report: typeof reportTypes[0], e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedReportType(report)
    setIsGenerateDialogOpen(true)
  }

  const startGenerating = () => {
    setIsGenerating(true)
    setGenerateProgress(0)

    const interval = setInterval(() => {
      setGenerateProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          return 100
        }
        return prev + Math.random() * 15
      })
    }, 200)

    setTimeout(() => {
      clearInterval(interval)
      setGenerateProgress(100)

      setTimeout(() => {
        const newReport: RecentReport = {
          id: `new-${Date.now()}`,
          name: `${selectedReportType?.name} - ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
          type: selectedReportType?.id || "performance",
          date: new Date().toISOString().split("T")[0],
          status: "ready",
          size: `${(Math.random() * 3 + 1).toFixed(1)} MB`,
        }
        setGeneratedReports((prev) => [newReport, ...prev])
        setIsGenerating(false)
        setIsGenerateDialogOpen(false)
        setGenerateProgress(0)
        toast.success("Report generated successfully", {
          description: `${newReport.name} is ready for download`,
        })
      }, 500)
    }, 2000)
  }

  const handleDownload = (report: RecentReport) => {
    toast.success("Download started", {
      description: `Downloading ${report.name}...`,
    })
  }

  return (
    <div className="space-y-6">
      {/* Facility Filter */}
      <div className="flex items-center gap-2">
        <Select value={selectedFacility} onValueChange={setSelectedFacility}>
          <SelectTrigger className="w-[180px]">
            <Building2 className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Facility" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Report Type Cards */}
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
                  <Badge variant="outline" className="text-xs mt-1">{report.frequency}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">{report.description}</p>
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleGenerateReport(report, e)
                }}
              >
                <FileBarChart className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Reports</CardTitle>
          <CardDescription>Previously generated reports available for download</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Report Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {generatedReports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {report.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {reportTypes.find((t) => t.id === report.type)?.name || report.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      {report.date}
                    </div>
                  </TableCell>
                  <TableCell>{report.size}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Ready
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault()
                        handleDownload(report)
                      }}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Contract Performance Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contract Performance</CardTitle>
          <CardDescription>Performance data from your active contracts</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={performanceColumns}
            data={data ?? []}
            searchKey="name"
            searchPlaceholder="Search contracts..."
            isLoading={isLoading}
          />
        </CardContent>
      </Card>

      {/* Generate Report Dialog */}
      <Dialog open={isGenerateDialogOpen} onOpenChange={(open) => {
        if (!isGenerating) {
          setIsGenerateDialogOpen(open)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedReportType && <selectedReportType.icon className="h-5 w-5 text-primary" />}
              Generate {selectedReportType?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedReportType?.description}
            </DialogDescription>
          </DialogHeader>

          {isGenerating ? (
            <div className="py-6 space-y-4">
              <div className="flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Generating report...</span>
                  <span>{Math.min(100, Math.round(generateProgress))}%</span>
                </div>
                <Progress value={Math.min(100, generateProgress)} />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                This may take a few moments depending on the data size.
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Report Period</Label>
                <Select value={reportPeriod} onValueChange={setReportPeriod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">Current Period</SelectItem>
                    <SelectItem value="last_month">Last Month</SelectItem>
                    <SelectItem value="last_quarter">Last Quarter</SelectItem>
                    <SelectItem value="ytd">Year to Date</SelectItem>
                    <SelectItem value="last_year">Last Year</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Facility</Label>
                <Select value={selectedFacility} onValueChange={setSelectedFacility}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Facilities</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border p-3 bg-muted/30">
                <div className="text-sm font-medium mb-1">Report Details</div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>Type:</span>
                    <span>{selectedReportType?.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Frequency:</span>
                    <span>{selectedReportType?.frequency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Format:</span>
                    <span>PDF</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {!isGenerating && (
              <>
                <Button variant="outline" onClick={() => setIsGenerateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    startGenerating()
                  }}
                >
                  <FileBarChart className="h-4 w-4 mr-2" />
                  Generate Report
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
