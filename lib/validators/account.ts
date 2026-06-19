import { z } from "zod"

// ─── Per-user Account / Profile ──────────────────────────────────
//
// Self-scoped identity fields (name / email / password). These feed
// the better-auth client mutations (updateUser / changeEmail /
// changePassword) from the AccountProfileCard. Password bounds mirror
// the server policy in lib/auth-server.ts (min 8 / max 128).

export const accountNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(128, "Name must be 128 characters or fewer")

export const accountEmailSchema = z.email("Enter a valid email address")

export const accountPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be 128 characters or fewer")

export const accountCurrentPasswordSchema = z
  .string()
  .min(1, "Current password is required")

// ─── Composite form schemas ──────────────────────────────────────

export const updateAccountNameSchema = z.object({
  name: accountNameSchema,
})
export type UpdateAccountNameInput = z.infer<typeof updateAccountNameSchema>

export const changeAccountEmailSchema = z.object({
  newEmail: accountEmailSchema,
})
export type ChangeAccountEmailInput = z.infer<typeof changeAccountEmailSchema>

export const changeAccountPasswordSchema = z
  .object({
    currentPassword: accountCurrentPasswordSchema,
    newPassword: accountPasswordSchema,
    confirmPassword: accountPasswordSchema,
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
export type ChangeAccountPasswordInput = z.infer<
  typeof changeAccountPasswordSchema
>
