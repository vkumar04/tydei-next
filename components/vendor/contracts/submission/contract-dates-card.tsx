"use client"

import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { CalendarIcon } from "lucide-react"

export interface ContractDatesCardProps {
  effectiveDate: Date | undefined
  onEffectiveDateChange: (date: Date | undefined) => void
  expirationDate: Date | undefined
  onExpirationDateChange: (date: Date | undefined) => void
  performancePeriod: string
  onPerformancePeriodChange: (value: string) => void
  rebatePayPeriod: string
  onRebatePayPeriodChange: (value: string) => void
}

export function ContractDatesCard({
  effectiveDate,
  onEffectiveDateChange,
  expirationDate,
  onExpirationDateChange,
  performancePeriod,
  onPerformancePeriodChange,
  rebatePayPeriod,
  onRebatePayPeriodChange,
}: ContractDatesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract Dates</CardTitle>
        <CardDescription>
          Set the contract timeline and evaluation periods
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Effective Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !effectiveDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {effectiveDate
                    ? format(effectiveDate, "PPP")
                    : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={effectiveDate}
                  onSelect={onEffectiveDateChange}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label>Expiration Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !expirationDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {expirationDate
                    ? format(expirationDate, "PPP")
                    : "Select date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={expirationDate}
                  onSelect={onExpirationDateChange}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Performance Period</Label>
            <Select
              value={performancePeriod}
              onValueChange={onPerformancePeriodChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">
                  Monthly - Evaluated every month
                </SelectItem>
                <SelectItem value="quarterly">
                  Quarterly - Evaluated every 3 months
                </SelectItem>
                <SelectItem value="semi_annual">
                  Semi-Annual - Evaluated every 6 months
                </SelectItem>
                <SelectItem value="annual">
                  Annual - Evaluated yearly
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Rebate Pay Period</Label>
            <Select
              value={rebatePayPeriod}
              onValueChange={onRebatePayPeriodChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">
                  Monthly - Paid every month
                </SelectItem>
                <SelectItem value="quarterly">
                  Quarterly - Paid every 3 months
                </SelectItem>
                <SelectItem value="semi_annual">
                  Semi-Annual - Paid every 6 months
                </SelectItem>
                <SelectItem value="annual">
                  Annual - Paid yearly
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
