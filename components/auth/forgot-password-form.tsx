"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from "next/link"
import { Loader2, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { requestPasswordReset } from "@/lib/actions/auth"
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validators"

export function ForgotPasswordForm() {
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
  })

  async function onSubmit(data: ForgotPasswordInput) {
    setIsLoading(true)
    try {
      await requestPasswordReset(data.email)
      setSent(true)
    } catch {
      toast.error("Something went wrong")
    } finally {
      setIsLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-primary" />
        <p className="text-sm text-muted-foreground">
          If an account with that email exists, we&apos;ve sent a password reset
          link. Check your inbox.
        </p>
        <Button variant="outline" asChild className="w-full">
          <Link href="/login">Back to Sign In</Link>
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="forgot-email">Email</Label>
        <Input
          id="forgot-email"
          type="email"
          placeholder="you@example.com"
          {...register("email")}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
        Send Reset Link
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline">
          Back to Sign In
        </Link>
      </p>
    </form>
  )
}
