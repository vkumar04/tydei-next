"use client"

import Link from "next/link"
import { ArrowRight, Building2, Truck } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { staggerContainer, fadeInUp } from "@/lib/animations"

const stats = [
  { value: "500+", label: "Facilities" },
  { value: "1,200+", label: "Vendors" },
  { value: "$2.4B", label: "Contracts Managed" },
]

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-4 pb-16 pt-20 sm:px-6 sm:pb-24 sm:pt-32 lg:px-8">
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <motion.div
        className="mx-auto max-w-4xl text-center"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={fadeInUp}>
          <Badge variant="secondary" className="mb-6">
            Healthcare Contract Intelligence
          </Badge>
        </motion.div>

        <motion.h1
          variants={fadeInUp}
          className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl"
        >
          <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
            Contract Management
          </span>
          <br />
          Built for Healthcare
        </motion.h1>

        <motion.p
          variants={fadeInUp}
          className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground"
        >
          TYDEi unifies contract tracking, rebate optimization, and vendor
          management into a single platform. Reduce leakage, ensure compliance,
          and unlock savings across your supply chain.
        </motion.p>

        <motion.div
          variants={fadeInUp}
          className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Button size="lg" asChild>
            <Link href="/dashboard">
              <Building2 className="mr-2 size-4" />
              Facility Portal
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/vendor/dashboard">
              <Truck className="mr-2 size-4" />
              Vendor Portal
            </Link>
          </Button>
        </motion.div>

        {/* Stats bar */}
        <motion.div
          className="mx-auto mt-16 grid max-w-lg grid-cols-3 gap-8"
          variants={staggerContainer}
        >
          {stats.map((stat) => (
            <motion.div key={stat.label} variants={fadeInUp} className="text-center">
              <p className="text-2xl font-bold text-primary sm:text-3xl">{stat.value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </section>
  )
}
