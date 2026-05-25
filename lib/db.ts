import dns from "node:dns"
import { PrismaClient } from "@prisma/client"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"

// Railway's legacy private networking (projects created before
// 2025-10-16) only publishes AAAA records for `*.railway.internal`
// hostnames — IPv6 only. Node.js's default `dns.lookup` resolution
// order prefers IPv4, so the pg client receives no usable address and
// every Prisma query errors out as ECONNREFUSED at the socket layer.
// Setting result-order to `ipv6first` lets Node return the AAAA
// record we actually need; IPv4-only hosts still resolve via the
// fallback. Safe to call at module-load time — process-wide, but
// only affects subsequent DNS lookups in this Node process.
// Ref: https://docs.railway.com/networking/private-networking/how-it-works
dns.setDefaultResultOrder("ipv6first")

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

// `family` is accepted by pg's underlying net.connect call but isn't
// in the published PoolConfig type, so cast the whole literal once.
// 0 = dual-stack (try IPv6 then IPv4) — pairs with setDefaultResultOrder
// above so legacy IPv6-only Railway hosts still connect while local dev
// (which serves both) keeps working.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  family: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any)
const adapter = new PrismaPg(pool)

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
