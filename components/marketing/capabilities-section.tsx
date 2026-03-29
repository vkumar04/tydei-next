"use client"

import { Users, LineChart, Zap } from "lucide-react"
import { motion } from "motion/react"
import { Badge } from "@/components/ui/badge"
import { staggerContainer, fadeInUp } from "@/lib/animations"

const capabilities = [
  {
    icon: Users,
    title: "Surgeon Scorecards",
    description:
      "Track payor mix, BMI, age, spend, and time scores per surgeon and CPT code",
  },
  {
    icon: LineChart,
    title: "True Margin Analysis",
    description:
      "Calculate margins with rebate contributions and tier discount savings",
  },
  {
    icon: Zap,
    title: "Real-time Compliance",
    description:
      "Instant alerts for off-contract purchases and pricing discrepancies",
  },
]

const metrics = [
  { label: "Rebates Earned", value: "$156,420", change: "+12.5%", positive: true },
  { label: "Compliance Rate", value: "94.2%", change: "+2.3%", positive: true },
  { label: "Active Contracts", value: "47", change: "+5", positive: true },
  { label: "Pending Alerts", value: "3", change: "-8", positive: true },
]

export function CapabilitiesSection() {
  return (
    <section id="capabilities" className="border-y bg-muted/30">
      <div className="container mx-auto px-4 py-20">
        <motion.div
          className="grid gap-12 lg:grid-cols-2 lg:gap-16 items-center"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
        >
          <motion.div variants={fadeInUp}>
            <Badge variant="outline" className="mb-4">
              Capabilities
            </Badge>
            <h2 className="mb-6 text-3xl font-bold text-foreground md:text-4xl">
              Built for Healthcare Contract Complexity
            </h2>
            <p className="mb-8 text-lg text-muted-foreground">
              From surgeon scorecards to true margin analysis, our platform handles
              the unique challenges of healthcare supply chain management.
            </p>

            <div className="space-y-6">
              {capabilities.map((item) => (
                <div key={item.title} className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div variants={fadeInUp} className="relative">
            <div className="rounded-2xl border bg-card p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-semibold">Contract Performance</h3>
                <Badge variant="secondary">Live Data</Badge>
              </div>
              <div className="space-y-4">
                {metrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <span className="text-sm text-muted-foreground">
                      {metric.label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{metric.value}</span>
                      <Badge
                        variant={metric.positive ? "default" : "destructive"}
                        className="text-xs"
                      >
                        {metric.change}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Decorative elements */}
            <div className="absolute -top-4 -right-4 h-24 w-24 rounded-full bg-primary/20 blur-3xl" />
            <div className="absolute -bottom-4 -left-4 h-32 w-32 rounded-full bg-accent/20 blur-3xl" />
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
