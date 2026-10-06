import { redirect } from "next/navigation"

export const instant = false

export default function AdminRoot() {
  redirect("/admin/dashboard")
}
