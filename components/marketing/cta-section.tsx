"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { scaleIn } from "@/lib/animations"

export function CtaSection() {
  return (
    <section className="container mx-auto px-4 py-20">
      <motion.div
        className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/80 p-12 text-center shadow-2xl"
        variants={scaleIn}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white/10 to-transparent" />
        <div className="relative">
          <h2 className="mb-4 text-3xl font-bold text-primary-foreground md:text-4xl text-balance">
            Make Your Vendors Manage Your Contracts
          </h2>
          <p className="mb-8 max-w-2xl mx-auto text-primary-foreground/80 text-lg">
            Stop spending hours on contract administration. Let vendors do the work
            while you maintain complete visibility and control over your agreements.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              variant="secondary"
              asChild
              className="gap-2 h-12 px-8 text-base shadow-lg"
            >
              <Link href="/dashboard">
                See Facility Portal <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="h-12 px-8 text-base bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10"
            >
              <Link href="/vendor/dashboard">See Vendor Portal</Link>
            </Button>
          </div>
        </div>
      </motion.div>
    </section>
  )
}
