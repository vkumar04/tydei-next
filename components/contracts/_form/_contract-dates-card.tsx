"use client"

import type { UseFormReturn } from "react-hook-form"
import type { CreateContractInput } from "@/lib/validators/contracts"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"
import { format, parseISO } from "date-fns"
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

function parseDateString(dateStr: string | undefined): Date | undefined {
  if (!dateStr) return undefined
  try {
    return parseISO(dateStr)
  } catch {
    return undefined
  }
}

function toDateString(date: Date | undefined): string {
  if (!date) return ""
  return format(date, "yyyy-MM-dd")
}

interface ContractDatesCardProps {
  form: UseFormReturn<CreateContractInput>
}

export function ContractDatesCard({ form }: ContractDatesCardProps) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = form

  const effectiveDateStr = watch("effectiveDate")
  const expirationDateStr = watch("expirationDate")
  const effectiveDate = parseDateString(effectiveDateStr)
  const expirationDate = parseDateString(expirationDateStr)

  // Charles 2026-06-10 (round 2, Mako tie-in screenshot showing
  // annual/quarterly): "Rebate pay period and performance period should be
  // the same" — not auto-sync-with-override, the SAME. One control writes
  // both columns; a stored mismatch is aligned on mount so saving the form
  // converges legacy rows. (Schema keeps both columns; display surfaces
  // already prefer term-level cadence via deriveContractCadence.)
  const performancePeriod = watch("performancePeriod") ?? "monthly"
  const storedPayPeriod = watch("rebatePayPeriod") ?? performancePeriod
  const hadMismatch = useRef(storedPayPeriod !== performancePeriod)
  useEffect(() => {
    if (hadMismatch.current) {
      setValue("rebatePayPeriod", performancePeriod)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract Dates</CardTitle>
        <CardDescription>Set the contract timeline</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Effective Date"
            error={errors.effectiveDate?.message}
            required
          >
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal h-10",
                    !effectiveDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                  {effectiveDate
                    ? format(effectiveDate, "MMMM do, yyyy")
                    : "Select start date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={effectiveDate}
                  onSelect={(date) =>
                    setValue("effectiveDate", toDateString(date))
                  }
                  captionLayout="dropdown"
                  startMonth={new Date(2020, 0)}
                  endMonth={new Date(2035, 11)}
                />
              </PopoverContent>
            </Popover>
          </Field>

          <Field
            label="Expiration Date"
            error={errors.expirationDate?.message}
            required
          >
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal h-10",
                    !expirationDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                  {expirationDate
                    ? format(expirationDate, "MMMM do, yyyy")
                    : "Select end date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={expirationDate}
                  onSelect={(date) =>
                    setValue("expirationDate", toDateString(date))
                  }
                  captionLayout="dropdown"
                  startMonth={new Date(2020, 0)}
                  endMonth={new Date(2035, 11)}
                  disabled={(date) =>
                    effectiveDate ? date < effectiveDate : false
                  }
                />
              </PopoverContent>
            </Popover>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Performance & Rebate Pay Period">
            <Select
              value={performancePeriod}
              onValueChange={(v) => {
                setValue(
                  "performancePeriod",
                  v as CreateContractInput["performancePeriod"]
                )
                setValue(
                  "rebatePayPeriod",
                  v as CreateContractInput["rebatePayPeriod"]
                )
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly - Evaluated &amp; paid every month</SelectItem>
                <SelectItem value="quarterly">Quarterly - Evaluated &amp; paid every 3 months</SelectItem>
                <SelectItem value="semi_annual">Semi-Annual - Evaluated &amp; paid every 6 months</SelectItem>
                <SelectItem value="annual">Annual - Evaluated &amp; paid yearly</SelectItem>
              </SelectContent>
            </Select>
            {hadMismatch.current ? (
              <p className="text-xs text-muted-foreground">
                This contract had a different pay period (
                {storedPayPeriod.replace("_", "-")}) — saving aligns it to the
                performance period.
              </p>
            ) : null}
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={watch("autoRenewal") ?? false}
            onCheckedChange={(checked) => setValue("autoRenewal", checked)}
          />
          <Label>Auto-renewal</Label>
        </div>

        {watch("autoRenewal") && (
          <Field label="Termination Notice (days)">
            <Input
              type="number"
              {...register("terminationNoticeDays", {
                valueAsNumber: true,
              })}
              placeholder="90"
            />
          </Field>
        )}
      </CardContent>
    </Card>
  )
}
