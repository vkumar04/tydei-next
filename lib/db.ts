import dns from "node:dns"
import { PrismaClient } from "@/lib/generated/prisma/client"
import type { PoolConfig } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"

// Railway's legacy private networking (projects created before
// 2025-10-16) only publishes AAAA records for `*.railway.internal`
// hostnames — IPv6 only. Node.js's default `dns.lookup` resolution
// order prefers IPv4, so without this override the pg client receives
// no usable address and every Prisma query errors out as ECONNREFUSED.
// Ref: https://docs.railway.com/networking/private-networking/how-it-works
dns.setDefaultResultOrder("ipv6first")

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

// Canonical Prisma 7 adapter setup — pass a PoolConfig object, not a
// hand-built Pool. adapter-pg's constructor takes
// `Pool | PoolConfig | string`; using a Pool requires that
// `pg.Pool` resolves to the SAME module instance inside the adapter
// (broken silently when bun de-dupe fails, which is how today's
// outage happened: 6540290). PoolConfig sidesteps that instanceof
// check entirely. `family: 0` is dual-stack (pairs with ipv6first).
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  family: 0,
} as PoolConfig)

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
