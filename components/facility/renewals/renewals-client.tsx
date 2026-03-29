"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PageHeader } from "@/components/shared/page-header"
import { RenewalInitiateDialog } from "./renewal-initiate-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { useExpiringContracts, useInitiateRenewal } from "@/hooks/use-renewals"
import { formatCurrency, formatDate } from "@/lib/formatting"
import {
  AlertTriangle,
  Clock,
  RefreshCw,
  CheckCircle2,
  FileText,
} from "lucide-react"
import { toast } from "sonner"
import { motion } from "motion/react"
import { staggerContainer, fadeInUp } from "@/lib/animations"
import type { ExpiringContract } from "@/lib/actions/renewals"

interface RenewalsClientProps {
  facilityId: string
}

function getDaysColor(days: number) {
  if (days < 30) return "text-red-600"
  if (days < 60) return "text-amber-500"
  return "text-green-600"
}

function getDaysBadgeVariant(
  days: number
): "destructive" | "secondary" | "outline" {
  if (days <= 30) return "destructive"
  if (days <= 60) return "secondary"
  return "outline"
}

function getLifecycleProgress(days: number, maxDays = 365) {
  return Math.max(5, Math.min(100, ((maxDays - days) / maxDays) * 100))
}

export function RenewalsClient({ facilityId }: RenewalsClientProps) {
  const [windowDays, setWindowDays] = useState(120)
  const [activeTab, setActiveTab] = useState("all")
  const [renewalTarget, setRenewalTarget] = useState<{
    id: string
    name: string
    vendor: string
  } | null>(null)

  const { data: contracts, isLoading } = useExpiringContracts(
    facilityId,
    windowDays,
    "facility"
  )
  const initiate = useInitiateRenewal()

  // Derive stat counts
  const stats = useMemo(() => {
    if (!contracts)
      return { expiringSoon: 0, expiring: 0, inRenewal: 0, totalActive: 0 }
    const expiringSoon = contracts.filter((c) => c.daysUntilExpiry < 30).length
    const expiring = contracts.filter(
      (c) => c.daysUntilExpiry >= 30 && c.daysUntilExpiry <= 90
    ).length
    const inRenewal = contracts.filter((c) => c.status === "expiring").length
    const totalActive = contracts.length
    return { expiringSoon, expiring, inRenewal, totalActive }
  }, [contracts])

  // Tab filtering
  const filteredContracts = useMemo(() => {
    if (!contracts) return []
    switch (activeTab) {
      case "urgent":
        return contracts.filter((c) => c.daysUntilExpiry < 30)
      case "inprogress":
        return contracts.filter((c) => c.status === "expiring")
      case "completed":
        return contracts.filter((c) => c.autoRenewal)
      default:
        return contracts
    }
  }, [contracts, activeTab])

  async function handleInitiate() {
    if (!renewalTarget) return
    try {
      await initiate.mutateAsync(renewalTarget.id)
      toast.success("Renewal draft created successfully")
    } catch {
      toast.error("Failed to create renewal draft")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Renewals"
        description="Track and manage expiring contracts"
        action={
          <Select
            value={String(windowDays)}
            onValueChange={(v) => setWindowDays(Number(v))}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Next 30 days</SelectItem>
              <SelectItem value="60">Next 60 days</SelectItem>
              <SelectItem value="90">Next 90 days</SelectItem>
              <SelectItem value="120">Next 120 days</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {/* Stat Cards */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
      ) : (
        <motion.div
          className="grid gap-4 md:grid-cols-4"
          variants={staggerContainer}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={fadeInUp}>
            <Card className="border-l-4 border-l-red-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Expiring Soon
                    </p>
                    <p className="text-2xl font-bold">{stats.expiringSoon}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      within 30 days
                    </p>
                  </div>
                  <AlertTriangle className="h-8 w-8 text-red-500/50" />
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Expiring</p>
                    <p className="text-2xl font-bold">{stats.expiring}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      30 - 90 days
                    </p>
                  </div>
                  <Clock className="h-8 w-8 text-amber-500/50" />
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">In Renewal</p>
                    <p className="text-2xl font-bold">{stats.inRenewal}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      renewal in progress
                    </p>
                  </div>
                  <RefreshCw className="h-8 w-8 text-blue-500/50" />
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div variants={fadeInUp}>
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Total Active
                    </p>
                    <p className="text-2xl font-bold">{stats.totalActive}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      contracts tracked
                    </p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-green-500/50" />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {/* Tabs + Contract Cards */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[180px] rounded-xl" />
          ))}
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="urgent">
              Urgent ({stats.expiringSoon})
            </TabsTrigger>
            <TabsTrigger value="inprogress">
              In Progress ({stats.inRenewal})
            </TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            {filteredContracts.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No Contracts"
                description="No contracts match this filter."
              />
            ) : (
              <motion.div
                className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
                variants={staggerContainer}
                initial="hidden"
                animate="show"
              >
                {filteredContracts.map((c) => (
                  <ContractRenewalCard
                    key={c.id}
                    contract={c}
                    onInitiate={() =>
                      setRenewalTarget({
                        id: c.id,
                        name: c.name,
                        vendor: c.vendorName,
                      })
                    }
                  />
                ))}
              </motion.div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <RenewalInitiateDialog
        contractName={renewalTarget?.name ?? ""}
        vendorName={renewalTarget?.vendor ?? ""}
        open={!!renewalTarget}
        onOpenChange={(open) => {
          if (!open) setRenewalTarget(null)
        }}
        onInitiate={handleInitiate}
      />
    </div>
  )
}

// ─── Contract Card ──────────────────────────────────────────────

function ContractRenewalCard({
  contract: c,
  onInitiate,
}: {
  contract: ExpiringContract
  onInitiate: () => void
}) {
  const daysColor = getDaysColor(c.daysUntilExpiry)

  return (
    <motion.div variants={fadeInUp}>
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="truncate text-sm font-medium">
                {c.name}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{c.vendorName}</p>
            </div>
            <Badge variant={getDaysBadgeVariant(c.daysUntilExpiry)}>
              <Clock className="mr-1 size-3" />
              {c.daysUntilExpiry}d
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
          {/* Key info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <p className="text-muted-foreground">Expiration</p>
              <p className="font-medium">{formatDate(c.expirationDate)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Days Remaining</p>
              <p className={`font-semibold ${daysColor}`}>
                {c.daysUntilExpiry} days
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Contract Value</p>
              <p className="font-medium">{formatCurrency(c.totalSpend)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tier</p>
              <p className="font-medium">{c.tierAchieved ?? "N/A"}</p>
            </div>
          </div>

          {/* Lifecycle progress bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Lifecycle</span>
              <span>
                {Math.round(getLifecycleProgress(c.daysUntilExpiry))}%
              </span>
            </div>
            <Progress
              value={getLifecycleProgress(c.daysUntilExpiry)}
              className="h-1.5"
            />
          </div>

          {/* Initiate Renewal button */}
          <Button
            size="sm"
            variant="outline"
            className="mt-auto w-full"
            onClick={onInitiate}
          >
            <RefreshCw className="mr-1.5 size-3" />
            Initiate Renewal
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  )
}
