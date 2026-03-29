"use client"

import { motion } from "motion/react"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { staggerContainer, fadeInUp } from "@/lib/animations"

const capabilities = [
  {
    title: "Surgeon Scorecards",
    description:
      "Compare physician-level product utilization against contract benchmarks. Identify preference-driven spend variance and drive standardization with data-backed conversations.",
  },
  {
    title: "True Margin Analysis",
    description:
      "Calculate real margins by layering rebates, admin fees, GPO tiers, and local pricing into a single view. No more surprises when rebate checks arrive.",
  },
  {
    title: "Real-Time Compliance",
    description:
      "Monitor purchasing patterns against contract terms continuously. Automatically flag off-contract purchases and notify the right stakeholders before small issues become large ones.",
  },
  {
    title: "Vendor Performance Tracking",
    description:
      "Score vendors across fill rate, pricing accuracy, rebate timeliness, and service levels. Use objective metrics during renegotiation cycles.",
  },
  {
    title: "Contract Renewal Intelligence",
    description:
      "Surface contracts approaching expiration with historical performance context and recommended negotiation positions based on utilization data.",
  },
]

export function CapabilitiesSection() {
  return (
    <section id="capabilities" className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Platform Capabilities
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Deep visibility into every dimension of your supply chain contracts.
          </p>
        </motion.div>

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
        >
          <Accordion type="single" collapsible className="mt-12">
            {capabilities.map((cap) => (
              <motion.div key={cap.title} variants={fadeInUp}>
                <AccordionItem value={cap.title}>
                  <AccordionTrigger className="text-left text-base font-medium">
                    {cap.title}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {cap.description}
                  </AccordionContent>
                </AccordionItem>
              </motion.div>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  )
}
