import {
  FileText,
  Calculator,
  LineChart,
  Bell,
  ArrowLeftRight,
  Sparkles,
} from "lucide-react"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const features = [
  {
    icon: FileText,
    title: "Contract Management",
    description: "Centralize every vendor contract with terms, tiers, and renewal dates in one place.",
  },
  {
    icon: Calculator,
    title: "Rebate Calculations",
    description: "Automated tier tracking and rebate projections based on real-time spend data.",
  },
  {
    icon: LineChart,
    title: "Analytics",
    description: "Surgeon scorecards, category spend trends, and true margin analysis dashboards.",
  },
  {
    icon: Bell,
    title: "Smart Alerts",
    description: "Instant notifications for off-contract purchases, expiring agreements, and pricing errors.",
  },
  {
    icon: ArrowLeftRight,
    title: "Dual Portal",
    description: "Separate facility and vendor portals with shared data and approval workflows.",
  },
  {
    icon: Sparkles,
    title: "AI Import",
    description: "Upload contracts as PDFs or spreadsheets and let AI extract terms, tiers, and pricing.",
  },
]

export function FeaturesGrid() {
  return (
    <section id="features" className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything You Need
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Purpose-built tools for healthcare contract intelligence, from
            intake to optimization.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="bg-card/80 backdrop-blur-lg transition-colors hover:bg-card"
            >
              <CardHeader>
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10">
                  <feature.icon className="size-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
