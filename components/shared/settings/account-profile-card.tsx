"use client"

import { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { CheckCircle2, Mail } from "lucide-react"
import {
  useMyAccount,
  useUpdateAccountName,
  useChangeAccountEmail,
  useChangeAccountPassword,
} from "@/hooks/use-account"
import {
  changeAccountEmailSchema,
  changeAccountPasswordSchema,
  updateAccountNameSchema,
} from "@/lib/validators/account"
import { toast } from "sonner"

/**
 * Per-user account/profile editor (name / email / password). Self-scoped:
 * every signed-in user edits their OWN account, so this card is NOT
 * gated by access tier. Mounted from the facility + vendor Settings
 * Profile tabs.
 */
export function AccountProfileCard() {
  const { data: account, isLoading } = useMyAccount()

  const updateName = useUpdateAccountName()
  const changeEmail = useChangeAccountEmail()
  const changePassword = useChangeAccountPassword()

  // Local form state — seeded from the loaded account via `key` reset on
  // the inner form (derive, don't mirror).
  const [name, setName] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [emailSent, setEmailSent] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>
            Manage your personal name, email, and password
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </CardContent>
      </Card>
    )
  }

  if (!account) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>
            Manage your personal name, email, and password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Unable to load your account.
          </p>
        </CardContent>
      </Card>
    )
  }

  // `key={account.id}` on the wrapper resets the uncontrolled defaults
  // when the account first loads.
  function handleSaveName() {
    const parsed = updateAccountNameSchema.safeParse({ name })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid name")
      return
    }
    updateName.mutate(parsed.data.name)
  }

  function handleChangeEmail() {
    const parsed = changeAccountEmailSchema.safeParse({ newEmail })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid email")
      return
    }
    changeEmail.mutate(parsed.data.newEmail, {
      onSuccess: () => setEmailSent(true),
    })
  }

  function handleChangePassword() {
    const parsed = changeAccountPasswordSchema.safeParse({
      currentPassword,
      newPassword,
      confirmPassword,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid password")
      return
    }
    changePassword.mutate(
      {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      },
      {
        onSuccess: () => {
          setCurrentPassword("")
          setNewPassword("")
          setConfirmPassword("")
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your account</CardTitle>
        <CardDescription>
          Manage your personal name, email, and password
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Name ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Name</h3>
          <div className="space-y-2">
            <Label htmlFor="account-name">Full name</Label>
            <Input
              id="account-name"
              defaultValue={account.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <Button
            size="sm"
            onClick={handleSaveName}
            disabled={updateName.isPending}
          >
            {updateName.isPending ? "Saving…" : "Save name"}
          </Button>
        </div>

        <Separator />

        {/* ── Email ────────────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Email address</h3>
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{account.email}</span>
            {account.emailVerified ? (
              <Badge variant="secondary" className="text-xs">
                Verified
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                Unverified
              </Badge>
            )}
          </div>

          {emailSent ? (
            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                Verification email sent to{" "}
                <span className="font-medium">{newEmail}</span>. Check your
                inbox to confirm the change — your email won&apos;t update
                until you click the link.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="account-new-email">New email address</Label>
              <div className="flex gap-2">
                <Input
                  id="account-new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <Button
                  variant="outline"
                  onClick={handleChangeEmail}
                  disabled={changeEmail.isPending}
                >
                  {changeEmail.isPending ? "Sending…" : "Change email"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* ── Password ─────────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Password</h3>
          <div className="space-y-2">
            <Label htmlFor="account-current-password">Current password</Label>
            <Input
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="account-new-password">New password</Label>
              <Input
                id="account-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-confirm-password">
                Confirm new password
              </Label>
              <Input
                id="account-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleChangePassword}
            disabled={changePassword.isPending}
          >
            {changePassword.isPending ? "Updating…" : "Change password"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
