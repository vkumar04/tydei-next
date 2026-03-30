import type { NextConfig } from "next"

const config: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
}

export default config
