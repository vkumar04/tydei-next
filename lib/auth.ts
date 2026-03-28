import { createAuthClient } from "better-auth/react"
import { organizationClient } from "better-auth/client/plugins"
import { stripeClient } from "@better-auth/stripe/client"

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_SITE_URL,
  plugins: [organizationClient(), stripeClient()],
})

export const { useSession, signIn, signUp, signOut } = authClient
