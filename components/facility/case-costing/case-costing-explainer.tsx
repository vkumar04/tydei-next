"use client"

import { useEffect, useState } from "react"
import {
  HelpCircle,
  DollarSign,
  PiggyBank,
  TrendingUp,
  Shield,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"

const STORAGE_KEY = "tydei:explainer:case-costing"

interface Section {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}

const sections: Section[] = [
  {
    icon: DollarSign,
    title: "Supply Cost vs. Purchase Cost",
    description:
      "Clinical supply cost reflects what the surgeon actually used during a procedure, while purchase cost is what the facility paid the vendor. The gap between these two numbers reveals opportunities for price negotiation and standardization savings.",
  },
  {
    icon: PiggyBank,
    title: "Rebate Contribution",
    description:
      "When purchases are made under active contracts, the facility earns rebates based on spend or volume tiers. These rebate dollars effectively reduce the net cost of each case and should be factored into true cost-per-case calculations.",
  },
  {
    icon: TrendingUp,
    title: "Margin Calculation",
    description:
      "Case margin is calculated as: Reimbursement - Purchase Cost = Margin. A positive margin means the facility earned more from the payor than it spent on supplies. Tracking margin by surgeon, procedure, and vendor highlights where profitability can improve.",
  },
  {
    icon: Shield,
    title: "On-Contract vs. Off-Contract",
    description:
      "On-contract purchases use pre-negotiated pricing and count toward rebate tiers. Off-contract purchases are at list price and generate no rebate value. Improving contract compliance directly reduces supply cost and increases rebate earnings.",
  },
]

export function CaseCostingExplainer() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === "open") setIsOpen(true)
  }, [])

  function handleToggle(open: boolean) {
    setIsOpen(open)
    localStorage.setItem(STORAGE_KEY, open ? "open" : "closed")
  }

  return (
    <Collapsible open={isOpen} onOpenChange={handleToggle}>
      <Card>
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-sm font-semibold">How Case Costing Works</h3>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {isOpen ? "Hide" : "Learn More"}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <CardContent className="grid gap-4 pt-0 sm:grid-cols-2">
            {sections.map((section) => (
              <div key={section.title} className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <section.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{section.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {section.description}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
