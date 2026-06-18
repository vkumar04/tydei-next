"use client"

import {
  FileText,
  TrendingUp,
  BarChart3,
  Bell,
  Building2,
  Sparkles,
  Stethoscope,
  Target,
  FileSearch,
  CheckCircle2,
} from "lucide-react"
import { motion } from "motion/react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { staggerContainer, fadeInUp } from "@/lib/animations"

const features = [
  {
    icon: FileText,
    title: "Contract Management",
    description:
      "Usage, Capital, Service, and Tie-In contracts with multi-tier rebate structures",
    features: [
      "Spend, Volume, and Price Reduction rebates",
      "Market Share and Carve Out tracking",
      "Grouped and multi-facility contracts",
    ],
  },
  {
    icon: TrendingUp,
    title: "Rebate Calculations",
    description:
      "Automated tier calculations with baseline logic and spend ranges",
    features: [
      "% of Spend, Fixed, and Per-Use rebates",
      "Monthly, Quarterly, Annual periods",
      "Real-time earned vs collected tracking",
    ],
  },
  {
    icon: Sparkles,
    title: "AI Document Extraction",
    description:
      "Let AI read your contracts — terms, tiers, and pricing pulled straight from PDFs and spreadsheets",
    features: [
      "Contract & amendment PDF parsing",
      "Payor-contract CPT rate extraction",
      "Intelligent column mapping for COG & pricing files",
    ],
  },
  {
    icon: Stethoscope,
    title: "Case Costing & Margins",
    description:
      "True per-case margin from supply cost, payor reimbursement, and rebate contribution",
    features: [
      "CPT / payor reimbursement rate cards",
      "Surgeon × vendor spend & compliance",
      "On- vs off-contract supply tracking",
    ],
  },
  {
    icon: Target,
    title: "Rebate Optimizer",
    description:
      "Model tier and rebate scenarios to find the best structure before you commit",
    features: [
      "What-if tier & threshold scenarios",
      "Projected earnings by structure",
      "Market-share modeling",
    ],
  },
  {
    icon: FileSearch,
    title: "Prospective Analysis",
    description:
      "Evaluate a proposed contract before signing — terms, pricing, and lookback in one verdict",
    features: [
      "Proposal & price-file analysis",
      "Historical lookback comparison",
      "Vendor proposal builder",
    ],
  },
  {
    icon: BarChart3,
    title: "Analytics & Reports",
    description:
      "Comprehensive dashboards with automated report delivery",
    features: [
      "Contract performance by type",
      "Spend by vendor / category analysis",
      "Scheduled PDF reports via email",
    ],
  },
  {
    icon: Bell,
    title: "Smart Alerts",
    description:
      "Real-time notifications for off-contract purchases and price discrepancies",
    features: [
      "Off-contract PO detection",
      "Price discrepancy & invoice variance",
      "Contract expiration & renewal reminders",
    ],
  },
  {
    icon: Building2,
    title: "Dual Portal System",
    description:
      "Separate views for facilities and vendors with appropriate data filtering",
    features: [
      "Facility: full COG and pricing access",
      "Vendor: filtered market-share view",
      "Role-based contract entry",
    ],
  },
]

export function FeaturesGrid() {
  return (
    <section id="features" className="container mx-auto px-4 py-20">
      <motion.div
        className="mb-16 text-center"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <Badge variant="outline" className="mb-4">
          Features
        </Badge>
        <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
          From Contract Terms to Case-Level Margins
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
          One platform for the whole lifecycle — capture contracts, automate
          rebates, cost every case, and keep facilities and vendors in sync.
        </p>
      </motion.div>

      <motion.div
        className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
        variants={staggerContainer}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true }}
      >
        {features.map((feature) => (
          <motion.div key={feature.title} variants={fadeInUp}>
            <Card className="group relative overflow-hidden transition-all hover:shadow-lg dark:hover:shadow-primary/5">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <CardHeader className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4 group-hover:bg-primary/20 transition-colors">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
                <CardDescription className="text-base">
                  {feature.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="relative">
                <ul className="space-y-2.5">
                  {feature.features.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>
    </section>
  )
}
