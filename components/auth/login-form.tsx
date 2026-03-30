"use client"

import { useState } from "react"
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
import { staggerContainer, fadeInUp } from "@/lib/animations"

export function LoginForm() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  async function onSubmit(data: LoginInput) {
    setIsLoading(true)
    try {
      const result = await signIn.email({
        email: data.email,
        password: data.password,
      })
      if (result.error) {
        toast.error(result.error.message ?? "Invalid credentials")
      } else {
        router.push("/dashboard")
        router.refresh()
      }
    } catch {
      toast.error("Something went wrong")
    } finally {
      setIsLoading(false)
    }
  }

  function handleDemoFill(email: string, password: string) {
    setValue("email", email)
    setValue("password", password)
  }

  return (
    <motion.form
      onSubmit={handleSubmit(onSubmit)}
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
        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
          Sign in
        </Button>
      </motion.div>

      <motion.div variants={fadeInUp}>
        <DemoLoginButtons onFill={handleDemoFill} isLoading={isLoading} />
      </motion.div>

      <motion.p variants={fadeInUp} className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/auth/sign-up" className="font-medium text-primary hover:underline">
          Contact your administrator
        </Link>
      </motion.p>
    </motion.form>
  )
}
