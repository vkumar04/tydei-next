"use client"

import { Upload, BarChart3, ShieldCheck } from "lucide-react"
import { motion } from "motion/react"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { staggerContainer, fadeInUp } from "@/lib/animations"

const props = [
  {
    icon: Upload,
    title: "Vendors Enter Data",
    description:
      "Vendors upload pricing files, COG data, and contract terms directly. No more spreadsheet exchanges or manual re-entry.",
  },
  {
    icon: BarChart3,
    title: "Vendors Track Progress",
    description:
      "Real-time dashboards let vendors monitor market share, rebate tiers, and compliance metrics across all facility relationships.",
  },
  {
    icon: ShieldCheck,
    title: "You Stay in Control",
    description:
      "Facilities approve every change, validate invoices automatically, and receive alerts when spending drifts off-contract.",
  },
]

export function ValueProps() {
  return (
    <section id="about" className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            How It Works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            A dual-portal platform where vendors and facilities collaborate
            transparently on contract data.
          </p>
        </motion.div>

        <motion.div
          className="mt-12 grid gap-6 sm:grid-cols-3"
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
        >
          {props.map((prop, i) => (
            <motion.div key={prop.title} variants={fadeInUp}>
              <Card className="bg-card/80 backdrop-blur-lg">
                <CardHeader>
                  <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <prop.icon className="size-5 text-primary" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {i + 1}
                    </span>
                    <CardTitle className="text-lg">{prop.title}</CardTitle>
                  </div>
                  <CardDescription className="mt-2">{prop.description}</CardDescription>
                </CardHeader>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
