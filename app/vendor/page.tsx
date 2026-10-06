import { redirect } from "next/navigation"

// v0 parity: v0's vendor root route was `/vendor` (the dashboard itself).
// Tydei's vendor dashboard lives at `/vendor/dashboard` to match the facility
// portal shape — this thin page keeps `/vendor` working so v0 links still resolve.
export default function VendorRootPage() {
  redirect("/vendor/dashboard")
}
