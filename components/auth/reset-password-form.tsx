"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { resetPassword as resetPasswordAction } from "@/lib/actions/auth"
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validators"

interface ResetPasswordFormProps {
  token: string
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
  })

  async function onSubmit(data: ResetPasswordInput) {
    setIsLoading(true)
    try {
      await resetPasswordAction(token, data.password)
      toast.success("Password reset successfully")
      router.push("/login")
    } catch {
      toast.error("Failed to reset password")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="new-password">New Password</Label>
        <Input
          id="new-password"
          type="password"
          placeholder="********"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-xs text-destructive">{errors.password.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirm-new-password">Confirm Password</Label>
        <Input
          id="confirm-new-password"
          type="password"
          placeholder="********"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
        Reset Password
      </Button>
    </form>
  )
}
