"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { getReportData, getContracts } from "@/lib/actions/reports"
import {
  getReportSchedules,
  createReportSchedule,
  toggleReportSchedule,
  deleteReportSchedule,
} from "@/lib/actions/report-scheduling"
import { useExportPDF } from "@/hooks/use-export-pdf"
import { toast } from "sonner"
import type { ContractPeriodRow } from "./report-columns"
import {
  ReportsHeader,
  QuickAccessCards,
  ReportFilters,
  DataReportTabContent,
  OverviewTab,
  CalculationAuditTab,
  ScheduledReportsCard,
  ScheduleReportDialog,
} from "./sections"
import type { ReportTab, NewScheduleState } from "./sections"

/* ─── Constants ───────────────────────────────────────────────── */

const ALL_REPORT_TABS = [
  { label: "Usage", value: "usage" },
  { label: "Service", value: "service" },
  { label: "Capital", value: "capital" },
  { label: "Tie-In", value: "tie_in" },
  { label: "Grouped", value: "grouped" },
  { label: "Pricing Only", value: "pricing_only" },
  { label: "Overview", value: "overview" },
  { label: "Calculation Audit", value: "calculations" },
] as const

const DATA_REPORT_TYPES = ["usage", "service", "capital", "tie_in", "grouped", "pricing_only"] as const

function getDefaultRange() {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), q * 3, 1)
  const to = new Date(now.getFullYear(), q * 3 + 3, 0)
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] }
}

/* ─── Main Component ──────────────────────────────────────────── */

interface ReportsClientProps {
  facilityId: string
}

export function ReportsClient({ facilityId }: ReportsClientProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>("usage")
  const [dateRange, setDateRange] = useState(getDefaultRange)
  const [metric] = useState<"totalSpend" | "rebateEarned" | "totalVolume">("totalSpend")
  const [selectedContractId, setSelectedContractId] = useState("all")
  const { exportPDF, isExporting } = useExportPDF()
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const [newSchedule, setNewSchedule] = useState<NewScheduleState>({
    reportType: "rebate_summary",
    frequency: "weekly",
    recipients: [],
    recipientInput: "",
    includeCharts: true,
    includeLineItems: false,
  })

  /* ── Queries ─────────────────────────────────────────────────── */

  const { data: contractsList } = useQuery({
    queryKey: queryKeys.contracts.list(facilityId, { reportSelector: true }),
    queryFn: () => getContracts(facilityId),
  })

  const serverReportType = useMemo(() => {
    if (activeTab === "overview" || activeTab === "calculations" || activeTab === "pricing_only") return "usage"
    return activeTab
  }, [activeTab])

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.data(facilityId, serverReportType, dateRange),
    queryFn: () =>
      getReportData({
        facilityId,
        reportType: serverReportType as "usage" | "service" | "tie_in" | "capital" | "grouped",
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
      }),
  })

  const { data: schedules, refetch: refetchSchedules } = useQuery({
    queryKey: ["report-schedules", facilityId],
    queryFn: () => getReportSchedules(facilityId),
  })

  /* ── Derived State ───────────────────────────────────────────── */

  const allPeriods: ContractPeriodRow[] = useMemo(() => {
    if (!data?.contracts) return []
    if (selectedContractId === "all") return data.contracts.flatMap((c) => c.periods)
    const match = data.contracts.find((c) => c.id === selectedContractId)
    return match?.periods ?? []
  }, [data, selectedContractId])

  const selectedContract = useMemo(() => {
    if (selectedContractId === "all" || !contractsList) return null
    return contractsList.find((c: { id: string }) => c.id === selectedContractId) ?? null
  }, [contractsList, selectedContractId])

  const visibleTabs = useMemo(() => {
    if (selectedContractId === "all" || !selectedContract) return ALL_REPORT_TABS
    const ct = (selectedContract as { contractType?: string }).contractType ?? "usage"
    const primary = ALL_REPORT_TABS.find((t) => t.value === ct)
    const overviewTab = ALL_REPORT_TABS.find((t) => t.value === "overview")!
    const calcTab = ALL_REPORT_TABS.find((t) => t.value === "calculations")!
    return primary ? [primary, overviewTab, calcTab] : [ALL_REPORT_TABS[0], overviewTab, calcTab]
  }, [selectedContractId, selectedContract])

  /* ── Handlers ────────────────────────────────────────────────── */

  const handleContractChange = (contractId: string) => {
    setSelectedContractId(contractId)
    if (contractId !== "all" && contractsList) {
      const contract = contractsList.find((c: { id: string }) => c.id === contractId)
      if (contract) {
        const typeMap: Record<string, ReportTab> = {
          usage: "usage",
          capital: "capital",
          service: "service",
          tie_in: "tie_in",
          grouped: "grouped",
          pricing_only: "pricing_only",
        }
        const mapped = typeMap[(contract as { contractType: string }).contractType]
        if (mapped) setActiveTab(mapped)
      }
    }
  }

  const handleExportClick = () => {
    if (selectedContractId !== "all") {
      exportPDF({
        type: "contract",
        id: selectedContractId,
        facilityId,
        dateRange,
      })
    } else {
      exportPDF({
        type: "rebate",
        facilityId,
        dateRange,
      })
    }
  }

  const handleAddRecipient = () => {
    const email = newSchedule.recipientInput.trim()
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !newSchedule.recipients.includes(email)) {
      setNewSchedule((prev) => ({
        ...prev,
        recipients: [...prev.recipients, email],
        recipientInput: "",
      }))
    }
  }

  const handleRemoveRecipient = (email: string) => {
    setNewSchedule((prev) => ({
      ...prev,
      recipients: prev.recipients.filter((r) => r !== email),
    }))
  }

  const handleCreateSchedule = async () => {
    if (newSchedule.recipients.length === 0) {
      toast.error("Please add at least one recipient")
      return
    }
    try {
      await createReportSchedule({
        facilityId,
        reportType: newSchedule.reportType,
        frequency: newSchedule.frequency,
        emailRecipients: newSchedule.recipients,
        isActive: true,
      })
      toast.success("Report schedule created")
      setScheduleDialogOpen(false)
      setNewSchedule({
        reportType: "rebate_summary",
        frequency: "weekly",
        recipients: [],
        recipientInput: "",
        includeCharts: true,
        includeLineItems: false,
      })
      refetchSchedules()
    } catch {
      toast.error("Failed to create schedule")
    }
  }

  const handleToggleSchedule = async (id: string) => {
    try {
      await toggleReportSchedule(id)
      refetchSchedules()
    } catch {
      toast.error("Failed to toggle schedule")
    }
  }

  const handleDeleteSchedule = async (id: string) => {
    try {
      await deleteReportSchedule(id)
      toast.success("Schedule deleted")
      refetchSchedules()
    } catch {
      toast.error("Failed to delete schedule")
    }
  }

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      <ReportsHeader
        isExporting={isExporting}
        onScheduleClick={() => setScheduleDialogOpen(true)}
        onExportClick={handleExportClick}
      />

      <QuickAccessCards />

      <ReportFilters
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        selectedContractId={selectedContractId}
        onContractChange={handleContractChange}
        contractsList={contractsList}
        selectedContract={selectedContract}
      />

      {/* Report Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReportTab)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
          <TabsList className="h-auto flex-wrap gap-1 p-1">
            {visibleTabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-4 py-2">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {selectedContract && (
            <Badge variant="outline" className="text-xs flex-shrink-0">
              Report format: {((selectedContract as { contractType?: string }).contractType ?? "usage").charAt(0).toUpperCase() + ((selectedContract as { contractType?: string }).contractType ?? "usage").slice(1)} Contract
            </Badge>
          )}
        </div>

        {/* Data-driven tabs */}
        {DATA_REPORT_TYPES.map((tab) => (
          <TabsContent key={tab} value={tab} className="space-y-6">
            <DataReportTabContent
              tab={tab}
              isLoading={isLoading}
              allPeriods={allPeriods}
              metric={metric}
              dateRange={dateRange}
            />
          </TabsContent>
        ))}

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : (
            <OverviewTab
              data={data}
              allPeriods={allPeriods}
              selectedContract={selectedContract}
              dateRange={dateRange}
            />
          )}
        </TabsContent>

        {/* Calculation Audit Tab */}
        <TabsContent value="calculations" className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : (
            <CalculationAuditTab data={data} allPeriods={allPeriods} dateRange={dateRange} />
          )}
        </TabsContent>
      </Tabs>

      <ScheduledReportsCard
        schedules={schedules}
        onAddClick={() => setScheduleDialogOpen(true)}
        onToggle={handleToggleSchedule}
        onDelete={handleDeleteSchedule}
      />

      <ScheduleReportDialog
        open={scheduleDialogOpen}
        onOpenChange={setScheduleDialogOpen}
        newSchedule={newSchedule}
        onScheduleChange={setNewSchedule}
        onAddRecipient={handleAddRecipient}
        onRemoveRecipient={handleRemoveRecipient}
        onCreateSchedule={handleCreateSchedule}
      />
    </div>
  )
}
