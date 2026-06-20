"use client"

import { useTransition } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn } from "@/lib/auth"
import { loginSchema, type LoginInput } from "@/lib/validators"
import { DemoLoginButtons } from "./demo-login-buttons"
import type { DemoAccount } from "@/lib/auth/demo-accounts"
import { staggerContainer, fadeInUp } from "@/lib/animations"

interface LoginFormProps {
  /** Demo accounts to offer as quick-login buttons. Null when demo logins are
   *  disabled (SHOW_DEMO_LOGINS) — the server passes nothing, so no demo
   *  credentials reach the client. */
  demoAccounts?: DemoAccount[] | null
}

export function LoginForm({ demoAccounts }: LoginFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

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
          const { message, status } = result.error
          toast.error(message || `Sign-in failed (status ${status ?? "?"})`)
        } else {
          router.push("/dashboard")
          router.refresh()
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
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Sign in
        </Button>
      </motion.div>

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
