import { requireVendor } from "@/lib/actions/auth"
import { MarketShareClient } from "@/components/vendor/market-share/market-share-client"

export default async function VendorMarketSharePage() {
  const { vendor } = await requireVendor()

  return <MarketShareClient vendorId={vendor.id} />
}
