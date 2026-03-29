"use client"

import { Building2, TrendingUp, Shield, CheckCircle2 } from "lucide-react"
import { motion } from "motion/react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { staggerContainer, fadeInUp } from "@/lib/animations"

const props = [
  {
    icon: Building2,
    title: "Vendors Enter Data",
    description:
      "Vendors input their own contract terms, tier structures, and pricing directly into the system",
    features: [
      "Contract terms and conditions",
      "Rebate tier structures",
      "Pricing and market share data",
    ],
  },
  {
    icon: TrendingUp,
    title: "Vendors Track Progress",
    description:
      "Real-time dashboards let vendors monitor their own performance across all your facilities",
    features: [
      "Spend and volume tracking",
      "Tier achievement status",
      "Market share compliance",
    ],
  },
  {
    icon: Shield,
    title: "You Stay in Control",
    description:
      "Approve changes, validate calculations, and maintain full visibility without the manual work",
    features: [
      "Approval workflows",
      "Calculation audit trails",
      "Discrepancy alerts",
    ],
  },
]

export function ValueProps() {
  return (
    <section
      id="about"
      className="border-y bg-gradient-to-b from-primary/5 to-background"
    >
      <div className="container mx-auto px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">
              The TYDEi Advantage
            </Badge>
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl text-balance">
              Stop Chasing Vendors. Let Them Work for You.
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto text-lg">
              Give vendors their own portal to manage contracts, track rebates, and ensure
              compliance. Your job becomes oversight, not administration.
            </p>
          </motion.div>

          <motion.div
            className="grid gap-8 md:grid-cols-3"
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
          >
            {props.map((prop) => (
              <motion.div key={prop.title} variants={fadeInUp}>
                <Card className="relative overflow-hidden border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
                  <CardHeader>
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 mb-2">
                      <prop.icon className="h-7 w-7 text-primary" />
                    </div>
                    <CardTitle className="text-xl">{prop.title}</CardTitle>
                    <CardDescription className="text-base">
                      {prop.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {prop.features.map((feature) => (
                        <li key={feature} className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>

          <motion.div
            className="mt-12 text-center"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
          >
            <p className="text-lg font-medium text-foreground mb-2">
              {'"We reduced contract admin time by 85% by letting vendors manage their own data."'}
            </p>
            <p className="text-sm text-muted-foreground">
              - Supply Chain Director, Regional Health System
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
