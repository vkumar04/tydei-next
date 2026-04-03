import { VendorContractEditClient } from "@/components/vendor/contracts/vendor-contract-edit-client"

export default async function VendorContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <VendorContractEditClient contractId={id} />
}
