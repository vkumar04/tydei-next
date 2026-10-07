import { redirect } from "next/navigation"

/**
 * The Create PO flow is handled via a dialog on the PO list page.
 * Redirect here so bookmarks and old links still work.
 */
export default function NewPurchaseOrderPage() {
  redirect("/dashboard/purchase-orders")
}
