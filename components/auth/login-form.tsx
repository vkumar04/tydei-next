"use client"

import { useEffect, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn } from "@/lib/auth"
import { resendVerificationEmail } from "@/lib/actions/auth"
import { loginSchema, type LoginInput } from "@/lib/validators"
import { DemoLoginButtons } from "./demo-login-buttons"
import type { DemoAccount } from "@/lib/auth/demo-accounts"
import { staggerContainer, fadeInUp } from "@/lib/animations"

/**
 * Where to land after a successful sign-in.
 *
 * `proxy.ts` puts the originally-requested path in `?callbackUrl=` when it
 * bounces an unauthenticated visitor here, but nothing read it — so you always
 * landed on /dashboard and lost your place (which also broke the
 * /accept-invitation round-trip).
 *
 * Read from window.location at submit time rather than via useSearchParams(),
 * which would force client rendering up to the nearest Suspense boundary on
 * this otherwise-static page.
 *
 * Only same-origin PATHS are honoured: an attacker-supplied absolute URL here
 * would be an open redirect. `/dashboard` is the default and is itself
 * role-aware server-side — it 307s an admin on to /admin/dashboard — so the
 * client doesn't need to know the caller's role.
 */
function safeDestination(callbackUrl: string | null): string {
  if (!callbackUrl) return "/dashboard"
  // Must be a root-relative path, and not protocol-relative ("//evil.com").
  if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) {
    return "/dashboard"
  }
  return callbackUrl
}

interface LoginFormProps {
  /** Demo accounts to offer as quick-login buttons. Null when demo logins are
   *  disabled (SHOW_DEMO_LOGINS) — the server passes nothing, so no demo
   *  credentials reach the client. */
  demoAccounts?: DemoAccount[] | null
}

export function LoginForm({ demoAccounts }: LoginFormProps) {
  const [isPending, startTransition] = useTransition()
  /**
   * Until React hydrates, the Sign-in button is a plain submit control inside
   * a `method="post"` form — so an early click does a NATIVE POST to /login.
   * That returns 200 and re-renders an EMPTY form: nothing signs in, the typed
   * credentials are gone, and the user clicks again. That is the reported
   * "have to click Sign in twice" (verified: `curl -X POST /login` returns the
   * login page). Playwright can't reproduce it because it waits for
   * actionability, i.e. always clicks post-hydration.
   *
   * Disabling until hydrated makes the early click a no-op instead of
   * destroying the user's input. An effect is the correct tool here — this is
   * genuinely "has the client taken over yet", which cannot be derived from
   * props or state.
   */
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  /** Set when sign-in is refused for an unverified address — drives the
   *  "resend verification" affordance below. */
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [isResending, startResend] = useTransition()

  function handleResendVerification() {
    if (!unverifiedEmail) return
    startResend(async () => {
      await resendVerificationEmail(unverifiedEmail)
      // Always the same message — the action is deliberately silent about
      // whether the address exists, so this must not leak either.
      toast.success("If that address needs verifying, a new link is on its way.")
    })
  }

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  function onSubmit(data: LoginInput) {
    startTransition(async () => {
      try {
        const result = await signIn.email({
          email: data.email,
          password: data.password,
        })
        if (result.error) {
          const { message, status, code } = result.error
          // `requireEmailVerification` is on, so an unverified account can
          // never sign in. better-auth re-sends the link on this attempt
          // (emailVerification.sendOnSignIn), but say so explicitly and
          // offer a manual re-send — otherwise the user is just stuck.
          if (code === "EMAIL_NOT_VERIFIED" || status === 403) {
            setUnverifiedEmail(data.email)
            toast.error(
              "Verify your email to sign in — we've sent you a fresh link.",
            )
          } else {
            toast.error(message || `Sign-in failed (status ${status ?? "?"})`)
          }
        } else {
          // Full-page navigation, deliberately — not router.push().
          //
          // Two reasons, both from the Next docs:
          //  1. `router.refresh()` refreshes the CURRENT route and clears the
          //     Client Cache for the current route only. Called right after
          //     push() it therefore refreshes /login (the route being left),
          //     not the destination, while racing the in-flight navigation.
          //     That is the "have to click Sign in twice" symptom.
          //  2. <Link> prefetches routes as they scroll into view, so the
          //     destination's RSC payload may already be cached from when the
          //     visitor was SIGNED OUT — i.e. the redirect-to-login result.
          //     A soft navigation can serve that stale payload and bounce
          //     straight back.
          //
          // A hard navigation guarantees the server re-renders with the
          // session cookie that sign-in just set. This runs once per login,
          // so the cost is irrelevant.
          const destination = safeDestination(
            new URLSearchParams(window.location.search).get("callbackUrl"),
          )
          window.location.assign(destination)
        }
      } catch {
        toast.error("Something went wrong")
      }
    })
  }

  function handleDemoFill(email: string, password: string) {
    setValue("email", email)
    setValue("password", password)
  }

  return (
    <motion.form
      onSubmit={handleSubmit(onSubmit)}
      // method="post" so a submit fired BEFORE React hydrates (user clicks
      // "Sign in" early) posts credentials in the request body, not as a GET
      // query string — otherwise the password lands in the URL / server
      // access logs / browser history. Once hydrated, handleSubmit
      // preventDefaults and runs the real signIn.
      method="post"
      className="space-y-4"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={fadeInUp} className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          {...register("email")}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email.message}</p>
        )}
      </motion.div>

      <motion.div variants={fadeInUp} className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        )}
      </motion.div>

      <motion.div variants={fadeInUp}>
        <Button type="submit" className="w-full" disabled={!hydrated || isPending}>
          {(isPending || !hydrated) && (
            <Loader2 className="mr-2 size-4 animate-spin" />
          )}
          Sign in
        </Button>
      </motion.div>

      {unverifiedEmail && (
        <motion.div
          variants={fadeInUp}
          className="rounded-lg border border-border bg-muted/50 p-3 text-sm"
        >
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">
              Your email isn&apos;t verified yet.
            </span>{" "}
            Check your inbox for the link — it may take a minute to arrive.
          </p>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto px-0 text-primary"
            onClick={handleResendVerification}
            disabled={isResending}
          >
            {isResending && <Loader2 className="mr-2 size-3 animate-spin" />}
            Send another verification email
          </Button>
        </motion.div>
      )}

      {demoAccounts && demoAccounts.length > 0 && (
        <motion.div variants={fadeInUp}>
          <DemoLoginButtons
            accounts={demoAccounts}
            onFill={handleDemoFill}
            isLoading={isPending}
          />
        </motion.div>
      )}

      <motion.p variants={fadeInUp} className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="font-medium text-primary hover:underline">
          Contact your administrator
        </Link>
      </motion.p>
    </motion.form>
  )
}
