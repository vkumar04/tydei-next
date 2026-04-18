export interface VendorRow {
  id: string
  name: string
  displayName: string | null
}

export function matchOrCreateVendorId(
  vendorName: string,
  vendors: VendorRow[],
): string | null {
  const fragment = vendorName.trim().toLowerCase()
  if (!fragment) return null
  const match = vendors.find((v) => {
    const a = v.name.toLowerCase()
    const b = (v.displayName ?? "").toLowerCase()
    return a.includes(fragment) || fragment.includes(a) || (b && (b.includes(fragment) || fragment.includes(b)))
  })
  return match?.id ?? null
}
