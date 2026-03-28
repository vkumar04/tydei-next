# Phase 0 -- Scaffold

## Objective

Initialize the Next.js 16 project with all tooling, infrastructure, folder structure, and provider wiring so every subsequent phase focuses purely on features. Zero business logic. After this phase, `bun dev` boots a styled, dark-themed app shell with working theme toggle and toast notifications.

## Dependencies

None (first phase).

## Init Commands

```bash
# Create project
bunx create-next-app@latest tydei-next --ts --tailwind --eslint --app --src-dir=false --import-alias="@/*" --turbopack
cd tydei-next

# Core deps
bun add prisma @prisma/client @prisma/adapter-pg pg better-auth
bun add @tanstack/react-query @tanstack/react-table
bun add react-hook-form @hookform/resolvers
bun add recharts lucide-react sonner next-themes zod
bun add resend @react-email/components
bun add xlsx @ai-sdk/google ai

# Dev deps
bun add -d @types/pg oxlint prisma zod-prisma-types

# shadcn init (new-york style, tailwind v4)
bunx shadcn@latest init -d

# Install all shadcn components needed across the project
bunx shadcn@latest add button card input select dialog tabs badge table scroll-area avatar dropdown-menu separator switch checkbox progress accordion collapsible tooltip popover calendar sheet skeleton label textarea command alert sidebar breadcrumb

# Prisma init
bunx prisma init --datasource-provider postgresql

# Docker Compose for local PostgreSQL
# (create docker-compose.yml manually -- see Config Files below)
```

## Config Files

### `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: tydei
      POSTGRES_PASSWORD: tydei_dev_password
      POSTGRES_DB: tydei
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### `prisma/prisma.config.ts`

```typescript
import path from "node:path"
import type { PrismaConfig } from "prisma"

export default {
  earlyAccess: true,
  schema: path.join(__dirname, "schema.prisma"),
} satisfies PrismaConfig
```

### `prisma/schema.prisma` (stub)

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

generator zod {
  provider                  = "zod-prisma-types"
  createRelationValuesTypes = true
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### `tsconfig.json` additions

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

### `.env.example`

```env
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei
BETTER_AUTH_SECRET=change-me-in-production
NEXT_PUBLIC_SITE_URL=http://localhost:3000
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_PRICE_ID=
STRIPE_ENTERPRISE_PRICE_ID=
NEXT_PUBLIC_STRIPE_PRICE_ID=
RESEND_API_KEY=
GOOGLE_API_KEY=
S3_ENDPOINT=
S3_REGION=auto
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

### `proxy.ts` (stub)

```typescript
import type { NextRequest } from "next/server"

export function proxy(request: NextRequest) {
  // Route protection will be added in Phase 1
  return undefined
}
```

### `railway.toml` (stub)

```toml
[build]
builder = "nixpacks"
buildCommand = "bun install && bunx prisma generate && bun run build"

[deploy]
startCommand = "bun run start"
healthcheckPath = "/"

[deploy.preDeployCommand]
command = "bunx prisma migrate deploy"
```

### `next.config.ts`

```typescript
import type { NextConfig } from "next"

const config: NextConfig = {
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
}

export default config
```

### `app/globals.css`

Copy theme from `.agent-suite/theme.css` (the full oklch theme with light/dark modes, sidebar colors, and chart palette).

### `oxlint.json`

```json
{
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "warn"
  }
}
```

### `package.json` scripts

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "oxlint .",
    "db:push": "prisma db push",
    "db:migrate": "prisma migrate dev",
    "db:seed": "bun run prisma/seed.ts",
    "db:studio": "prisma studio"
  }
}
```

## Folder Structure

```
tydei-next/
├── app/
│   ├── (auth)/
│   │   ├── layout.tsx           -- centered card layout
│   │   ├── login/page.tsx       -- placeholder
│   │   └── sign-up/page.tsx     -- placeholder
│   ├── (facility)/
│   │   ├── layout.tsx           -- placeholder (will be PortalShell)
│   │   └── dashboard/page.tsx   -- placeholder
│   ├── (vendor)/
│   │   ├── layout.tsx           -- placeholder
│   │   └── dashboard/page.tsx   -- placeholder
│   ├── (admin)/
│   │   ├── layout.tsx           -- placeholder
│   │   └── dashboard/page.tsx   -- placeholder
│   ├── (marketing)/
│   │   ├── layout.tsx           -- standalone layout (no sidebar)
│   │   └── page.tsx             -- placeholder landing
│   ├── api/
│   │   └── auth/
│   │       └── [...all]/route.ts  -- Better Auth catch-all (stub)
│   ├── globals.css              -- theme from .agent-suite/theme.css
│   ├── layout.tsx               -- root layout with all providers
│   └── not-found.tsx            -- 404 page
├── components/
│   ├── ui/                      -- shadcn components (auto-installed)
│   ├── shared/                  -- (empty, populated in Phase 1)
│   ├── facility/                -- (empty)
│   ├── vendor/                  -- (empty)
│   ├── admin/                   -- (empty)
│   └── contracts/               -- (empty)
├── lib/
│   ├── db.ts                    -- Prisma client singleton
│   ├── auth.ts                  -- Better Auth client (stub)
│   ├── auth-server.ts           -- Better Auth server config (stub)
│   ├── utils.ts                 -- cn() helper
│   ├── formatting.ts            -- formatCurrency, formatDate, formatPercent, formatCompactNumber
│   ├── validators.ts            -- (empty, populated after schema)
│   ├── query-keys.ts            -- (empty, populated in Phase 2)
│   └── constants.ts             -- (empty, populated in Phase 1)
├── hooks/                       -- (empty)
├── prisma/
│   ├── prisma.config.ts
│   └── schema.prisma            -- stub
├── public/                      -- static assets
├── proxy.ts                     -- Next.js 16 route protection stub
├── docker-compose.yml
├── railway.toml
├── .env.example
├── .env                         -- local (gitignored)
├── oxlint.json
├── next.config.ts
├── tailwind.config.ts           -- (if needed; Tailwind v4 uses CSS config)
├── tsconfig.json
└── package.json
```

## Theme

Use the full theme from `.agent-suite/theme.css`:
- Deep teal primary (`oklch(0.45 0.12 195)` light / `oklch(0.72 0.16 175)` dark)
- Vibrant blue accent (`oklch(0.58 0.18 255)` light / `oklch(0.68 0.18 250)` dark)
- Dark mode is default
- Inter font for body, Geist Mono for code
- `0.625rem` border radius
- Dark sidebar with layered surfaces

## Root Layout (`app/layout.tsx`)

```typescript
// ~40 lines
// - html lang="en" suppressHydrationWarning
// - ThemeProvider from next-themes (defaultTheme="dark")
// - QueryClientProvider (TanStack Query)
// - Toaster from sonner
// - Inter + Geist Mono fonts via next/font
// - children
```

## Providers File (`components/providers.tsx`)

```typescript
// ~30 lines
// - "use client"
// - QueryClient with default options (staleTime: 60_000)
// - QueryClientProvider wrapping children
// - ThemeProvider wrapping QueryClientProvider
// - Toaster at the bottom
```

## Lib Files

### `lib/db.ts`

```typescript
// ~15 lines
// Prisma client singleton with adapter-pg
// globalThis caching for dev hot-reload
```

### `lib/utils.ts`

```typescript
// ~5 lines
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### `lib/formatting.ts`

```typescript
// ~40 lines
export function formatCurrency(value: number): string { /* Intl.NumberFormat USD */ }
export function formatDate(date: string | Date): string { /* MMM d, yyyy */ }
export function formatDateRange(start: string | Date, end: string | Date): string { /* range */ }
export function formatPercent(value: number, decimals?: number): string { /* e.g., 12.5% */ }
export function formatCompactNumber(value: number): string { /* e.g., 1.2M */ }
```

## shadcn Components to Install

Button, Card, Input, Select, Dialog, Tabs, Badge, Table, ScrollArea, Avatar, DropdownMenu, Separator, Switch, Checkbox, Progress, Accordion, Collapsible, Tooltip, Popover, Calendar, Sheet, Skeleton, Label, Textarea, Command, Alert, Sidebar, Breadcrumb.

## Acceptance Criteria

1. `docker compose up -d` starts PostgreSQL on port 5432
2. `bun dev` boots without errors on `http://localhost:3000`
3. Root layout renders with dark theme by default
4. All route groups exist: `(auth)`, `(facility)`, `(vendor)`, `(admin)`, `(marketing)`
5. Each route group has a placeholder layout and at least one placeholder page
6. Theme toggle switches between light/dark/system
7. `toast("Hello")` renders a Sonner notification
8. Prisma client instantiates without errors (schema is a stub)
9. `proxy.ts` exists (stub, no logic yet)
10. `lib/formatting.ts` exports all four formatting functions with correct output
11. All shadcn components are installed and importable
12. TypeScript strict mode is enforced with zero type errors
13. `.env.example` contains all required environment variable keys
14. `railway.toml` is present with build/deploy/preDeployCommand configuration
