"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Plus,
  FileText,
  CheckCircle,
  DollarSign,
  Building2,
  Eye,
  Edit,
  Trash2,
  Search,
  Download,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import {
  getPayorContracts,
  createPayorContract,
  deletePayorContract,
} from "@/lib/actions/admin/payor-contracts"
import { adminGetFacilities } from "@/lib/actions/admin/facilities"
import { queryKeys } from "@/lib/query-keys"

interface PayorContractRate {
  cptCode: string
  description?: string
  rate: number
  effectiveDate?: string
  expirationDate?: string
}

interface PayorContractGrouper {
  grouperName: string
  rate: number
  effectiveDate?: string
  expirationDate?: string
}

interface PayorContractRow {
  id: string
  payorName: string
  payorType: string
  contractNumber: string
  facilityId: string
  facilityName: string
  effectiveDate: string
  expirationDate: string
  status: string
  cptRates: PayorContractRate[]
  grouperRates: PayorContractGrouper[]
  multiProcedureRule?: { primary: number; secondary: number }
  implantPassthrough?: boolean
  implantMarkup?: number
  notes?: string | null
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(value)

const formatDate = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return dateStr
  }
}

export function PayorContractTable() {
  const qc = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [showRatesDialog, setShowRatesDialog] = useState(false)
  const [selectedContract, setSelectedContract] = useState<PayorContractRow | null>(null)
  const [deleting, setDeleting] = useState<PayorContractRow | null>(null)

  // Form state
  const [newContract, setNewContract] = useState({
    payorName: "",
    payorType: "commercial" as
      | "commercial"
      | "medicare_advantage"
      | "medicaid_managed"
      | "workers_comp",
    facilityId: "",
    contractNumber: "",
    effectiveDate: "",
    expirationDate: "",
    notes: "",
  })

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.payorContracts(),
    queryFn: () => getPayorContracts({}),
  })

  const { data: facilityData } = useQuery({
    queryKey: queryKeys.admin.facilities({}),
    queryFn: () => adminGetFacilities({}),
  })

  const createMut = useMutation({
    mutationFn: createPayorContract,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.payorContracts() })
      setShowUploadDialog(false)
      resetForm()
      toast.success("Payor contract created")
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePayorContract(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.payorContracts() })
      setDeleting(null)
      toast.success("Payor contract deleted")
    },
  })

  const resetForm = () => {
    setNewContract({
      payorName: "",
      payorType: "commercial",
      facilityId: "",
      contractNumber: "",
      effectiveDate: "",
      expirationDate: "",
      notes: "",
    })
  }

  const handleSubmit = async () => {
    if (!newContract.payorName || !newContract.facilityId) {
      toast.error("Payor name and facility are required")
      return
    }
    await createMut.mutateAsync({
      payorName: newContract.payorName,
      payorType: newContract.payorType,
      facilityId: newContract.facilityId,
      contractNumber: newContract.contractNumber || `AUTO-${Date.now()}`,
      effectiveDate:
        newContract.effectiveDate || new Date().toISOString().split("T")[0],
      expirationDate:
        newContract.expirationDate ||
        new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
      status: "active",
      cptRates: [],
      grouperRates: [],
      implantPassthrough: true,
      implantMarkup: 0,
      notes: newContract.notes,
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
            Active
          </Badge>
        )
      case "expired":
        return <Badge variant="destructive">Expired</Badge>
      case "pending":
        return <Badge variant="secondary">Pending</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const contracts = (data?.contracts ?? []) as unknown as PayorContractRow[]
  const facilities = facilityData?.facilities ?? []
  const activeContracts = contracts.filter((c) => c.status === "active")
  const totalContractedRates = contracts.reduce(
    (sum, c) => sum + (c.cptRates ?? []).length,
    0
  )
  const uniquePayors = new Set(contracts.map((c) => c.payorName)).size

  const filteredContracts = contracts.filter(
    (c) =>
      c.payorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.facilityName ?? "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      (c.contractNumber ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <>
      {/* Add Contract Dialog Trigger (via header button rendered below) */}
      <div className="flex items-center justify-end">
        <Dialog
          open={showUploadDialog}
          onOpenChange={(open) => {
            setShowUploadDialog(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Contract
            </Button>
          </DialogTrigger>
          <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Upload Payor Contract</DialogTitle>
              <DialogDescription>
                Upload a payor contract to extract reimbursement rates for case
                costing.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payorName">Payor Name *</Label>
                  <Select
                    value={newContract.payorName}
                    onValueChange={(v) =>
                      setNewContract((prev) => ({ ...prev, payorName: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select payor..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Anthem Blue Cross Blue Shield">
                        Anthem BCBS
                      </SelectItem>
                      <SelectItem value="United Healthcare">
                        United Healthcare
                      </SelectItem>
                      <SelectItem value="Cigna">Cigna</SelectItem>
                      <SelectItem value="Aetna">Aetna</SelectItem>
                      <SelectItem value="Humana">Humana</SelectItem>
                      <SelectItem value="Blue Cross Blue Shield">
                        Blue Cross Blue Shield
                      </SelectItem>
                      <SelectItem value="Medicare Advantage">
                        Medicare Advantage
                      </SelectItem>
                      <SelectItem value="Medicaid Managed Care">
                        Medicaid Managed Care
                      </SelectItem>
                      <SelectItem value="Workers Compensation">
                        Workers Compensation
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payorType">Contract Type</Label>
                  <Select
                    value={newContract.payorType}
                    onValueChange={(v) =>
                      setNewContract((prev) => ({
                        ...prev,
                        payorType: v as typeof prev.payorType,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="commercial">Commercial</SelectItem>
                      <SelectItem value="medicare_advantage">
                        Medicare Advantage
                      </SelectItem>
                      <SelectItem value="medicaid_managed">
                        Medicaid Managed
                      </SelectItem>
                      <SelectItem value="workers_comp">Workers Comp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="facility">Facility *</Label>
                  <Select
                    value={newContract.facilityId}
                    onValueChange={(v) =>
                      setNewContract((prev) => ({ ...prev, facilityId: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select facility..." />
                    </SelectTrigger>
                    <SelectContent>
                      {facilities.map((facility) => (
                        <SelectItem key={facility.id} value={facility.id}>
                          {facility.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contractNumber">Contract Number</Label>
                  <Input
                    id="contractNumber"
                    value={newContract.contractNumber}
                    onChange={(e) =>
                      setNewContract((prev) => ({
                        ...prev,
                        contractNumber: e.target.value,
                      }))
                    }
                    placeholder="e.g., ASC-2024-001"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="effectiveDate">Effective Date</Label>
                  <Input
                    id="effectiveDate"
                    type="date"
                    value={newContract.effectiveDate}
                    onChange={(e) =>
                      setNewContract((prev) => ({
                        ...prev,
                        effectiveDate: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expirationDate">Expiration Date</Label>
                  <Input
                    id="expirationDate"
                    type="date"
                    value={newContract.expirationDate}
                    onChange={(e) =>
                      setNewContract((prev) => ({
                        ...prev,
                        expirationDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={newContract.notes}
                  onChange={(e) =>
                    setNewContract((prev) => ({
                      ...prev,
                      notes: e.target.value,
                    }))
                  }
                  placeholder="Add any notes about this contract..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowUploadDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  !newContract.payorName ||
                  !newContract.facilityId ||
                  createMut.isPending
                }
              >
                {createMut.isPending ? "Saving..." : "Save Contract"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Contracts
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{contracts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Contracts
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeContracts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total CPT Rates
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalContractedRates}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Payors Covered
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniquePayors}</div>
          </CardContent>
        </Card>
      </div>

      {/* Contracts Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Contract List</CardTitle>
              <CardDescription>
                View and manage payor contracts and reimbursement rates
              </CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search contracts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payor</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead>Contract #</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>CPT Rates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Loading contracts...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                filteredContracts.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">
                      {contract.payorName}
                    </TableCell>
                    <TableCell>{contract.facilityName}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {contract.contractNumber}
                    </TableCell>
                    <TableCell>{formatDate(contract.effectiveDate)}</TableCell>
                    <TableCell>{formatDate(contract.expirationDate)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {(contract.cptRates ?? []).length} rates
                      </Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(contract.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedContract(contract)
                            setShowRatesDialog(true)
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(contract)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              {!isLoading && filteredContracts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No contracts found. Upload your first payor contract to get
                    started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* View Rates Dialog */}
      <Dialog open={showRatesDialog} onOpenChange={setShowRatesDialog}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedContract?.payorName} - Contract Rates
            </DialogTitle>
            <DialogDescription>
              CPT code reimbursement rates for {selectedContract?.facilityName}
            </DialogDescription>
          </DialogHeader>

          {selectedContract && (
            <Tabs defaultValue="cpt-rates" className="w-full">
              <TabsList>
                <TabsTrigger value="cpt-rates">
                  CPT Rates ({(selectedContract.cptRates ?? []).length})
                </TabsTrigger>
                <TabsTrigger value="groupers">
                  Groupers ({(selectedContract.grouperRates ?? []).length})
                </TabsTrigger>
                <TabsTrigger value="terms">Contract Terms</TabsTrigger>
              </TabsList>

              <TabsContent value="cpt-rates" className="mt-4">
                <div className="rounded-md border max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>CPT Code</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedContract.cptRates ?? []).length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center py-6 text-muted-foreground"
                          >
                            No CPT rates configured yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {(selectedContract.cptRates ?? []).map((rate, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono font-medium">
                            {rate.cptCode}
                          </TableCell>
                          <TableCell>{rate.description}</TableCell>
                          <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                            {formatCurrency(rate.rate)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {rate.effectiveDate
                              ? formatDate(rate.effectiveDate)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {rate.expirationDate
                              ? formatDate(rate.expirationDate)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="groupers" className="mt-4">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grouper</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedContract.grouperRates ?? []).length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center py-6 text-muted-foreground"
                          >
                            No grouper rates configured yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {(selectedContract.grouperRates ?? []).map(
                        (grouper, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">
                              {grouper.grouperName}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                              {formatCurrency(grouper.rate)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {grouper.effectiveDate
                                ? formatDate(grouper.effectiveDate)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {grouper.expirationDate
                                ? formatDate(grouper.expirationDate)
                                : "—"}
                            </TableCell>
                          </TableRow>
                        )
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="terms" className="mt-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                          Multiple Procedure Rule
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">
                          {selectedContract.multiProcedureRule?.primary ?? 100}
                          % /{" "}
                          {selectedContract.multiProcedureRule?.secondary ?? 50}
                          %
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Primary / Secondary procedure rates
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                          Implant Passthrough
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">
                          {selectedContract.implantPassthrough ? "Yes" : "No"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {selectedContract.implantMarkup ?? 0}% markup on
                          invoice cost
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                  {selectedContract.notes && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Notes</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm">{selectedContract.notes}</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRatesDialog(false)}
            >
              Close
            </Button>
            <Button>
              <Download className="mr-2 h-4 w-4" />
              Export Rates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete Payor Contract"
        description={`Delete payor contract "${deleting?.payorName}"?`}
        onConfirm={async () => {
          if (deleting) await deleteMut.mutateAsync(deleting.id)
        }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}
