import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { organization } from "better-auth/plugins"
import { stripe } from "@better-auth/stripe"
import Stripe from "stripe"
import { Resend } from "resend"
import { prisma } from "@/lib/db"

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!)
const resend = new Resend(process.env.RESEND_API_KEY)

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  rateLimit: {
    window: 60,
    max: 100,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,      // refresh every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await resend.emails.send({
        from: "TYDEi <noreply@tydei.com>",
        to: user.email,
        subject: "Reset your password",
        html: `<a href="${url}">Reset password</a>`,
      })
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await resend.emails.send({
        from: "TYDEi <noreply@tydei.com>",
        to: user.email,
        subject: "Verify your email",
        html: `<a href="${url}">Verify email</a>`,
      })
    },
  },
  plugins: [
    organization(),
    stripe({
      stripeClient,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    }),
  ],
})
