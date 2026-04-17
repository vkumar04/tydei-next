import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, Gauge, CheckCircle2, DollarSign } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import type { VendorProposal } from "@/lib/actions/prospective"

interface Props {
  proposals: VendorProposal[]
  totalProposals: number
  totalProjectedSpend: number
}

export function TopMetrics({ proposals, totalProposals, totalProjectedSpend }: Props) {
  const scored = proposals.filter((p) => p.dealScore)
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((s, p) => s + (p.dealScore?.overall ?? 0), 0) / scored.length)
      : null
  const acceptable = proposals.filter(
    (p) =>
      p.dealScore &&
      (p.dealScore.recommendation === "accept" || p.dealScore.recommendation === "strong_accept"),
  ).length

  const cards = [
    {
      icon: FileText,
      title: "Total Proposals",
      value: String(totalProposals),
      sub: `${scored.length} scored`,
    },
    {
      icon: Gauge,
      title: "Avg Deal Score",
      value: avgScore ? String(avgScore) : "-",
      sub: "Across scored deals",
    },
    {
      icon: CheckCircle2,
      title: "Acceptable Deals",
      value: String(acceptable),
      sub: "Score 75+ recommended",
      valueClass: "text-green-600",
    },
    {
      icon: DollarSign,
      title: "Total Projected Spend",
      value: formatCurrency(totalProjectedSpend),
      sub: "Across all proposals",
    },
  ] as const

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
            <c.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${"valueClass" in c ? c.valueClass : ""}`}>
              {c.value}
            </div>
            <p className="text-xs text-muted-foreground">{c.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
