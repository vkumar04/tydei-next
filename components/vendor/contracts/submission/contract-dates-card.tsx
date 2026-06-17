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
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- Calendar inside a Popover: focus must land on the day grid when the popover opens so keyboard users can navigate dates (canonical shadcn/react-day-picker pattern).
                  autoFocus
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
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- Calendar inside a Popover: focus must land on the day grid when the popover opens so keyboard users can navigate dates (canonical shadcn/react-day-picker pattern).
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Charles 2026-06-10: performance and rebate pay period are the
              SAME — one control writes both values. */}
          <div className="space-y-2">
            <Label>Performance &amp; Rebate Pay Period</Label>
            <Select
              value={performancePeriod}
              onValueChange={(v) => {
                onPerformancePeriodChange(v)
                onRebatePayPeriodChange(v)
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">
                  Monthly - Evaluated &amp; paid every month
                </SelectItem>
                <SelectItem value="quarterly">
                  Quarterly - Evaluated &amp; paid every 3 months
                </SelectItem>
                <SelectItem value="semi_annual">
                  Semi-Annual - Evaluated &amp; paid every 6 months
                </SelectItem>
                <SelectItem value="annual">
                  Annual - Evaluated &amp; paid yearly
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
