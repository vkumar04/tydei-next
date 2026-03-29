"use client"

import Link from "next/link"
import { ArrowRight, Sparkles } from "lucide-react"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { staggerContainer, fadeInUp } from "@/lib/animations"

const stats = [
  { value: "$2.4M+", label: "Rebates Tracked" },
  { value: "150+", label: "Vendor Partnerships" },
  { value: "85%", label: "Admin Time Saved" },
  { value: "24/7", label: "Vendor Self-Service" },
]

export function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />

      <motion.div
        className="container relative mx-auto px-4 py-24 lg:py-32"
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <div className="mx-auto max-w-4xl text-center">
          <motion.div variants={fadeInUp}>
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm font-medium">
              <Sparkles className="mr-2 h-3.5 w-3.5" />
              Healthcare Contract Intelligence
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeInUp}
            className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl text-balance"
          >
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Make Your Vendors
            </span>
            <br />
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Manage Your Contracts
            </span>
          </motion.h1>

          <motion.p
            variants={fadeInUp}
            className="mb-10 text-lg text-muted-foreground max-w-2xl mx-auto text-pretty leading-relaxed"
          >
            TYDEi Platform empowers vendors to track their own contracts, validate rebates,
            and maintain compliance - reducing your administrative burden while maximizing your earnings.
          </motion.p>

          <motion.div
            variants={fadeInUp}
            className="flex flex-col gap-4 sm:flex-row sm:justify-center"
          >
            <Button size="lg" asChild className="gap-2 h-12 px-8 text-base shadow-lg hover:shadow-xl transition-shadow">
              <Link href="/dashboard">
                Facility Portal <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 px-8 text-base">
              <Link href="/vendor/dashboard">Vendor Portal</Link>
            </Button>
          </motion.div>

          {/* Stats */}
          <motion.div
            className="mt-16 grid grid-cols-2 gap-8 md:grid-cols-4"
            variants={staggerContainer}
          >
            {stats.map((stat) => (
              <motion.div key={stat.label} variants={fadeInUp} className="text-center">
                <div className="text-2xl font-bold text-foreground md:text-3xl">
                  {stat.value}
                </div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </motion.div>
    </section>
  )
}
