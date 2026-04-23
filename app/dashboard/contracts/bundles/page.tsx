import Link from "next/link"
import { listBundles } from "@/lib/actions/bundles"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export default async function BundlesPage() {
  const bundles = await listBundles()

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tie-In Bundles</h1>
          <p className="text-sm text-muted-foreground">
            Multi-product contracts with combined compliance + rebate
            structures. Each bundle evaluates via{" "}
            <span className="font-mono">all_or_nothing</span>,{" "}
            <span className="font-mono">proportional</span>, or{" "}
            <span className="font-mono">cross_vendor</span> semantics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/contracts">← Contracts</Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/contracts/bundles/new">+ New bundle</Link>
          </Button>
        </div>
      </div>

      {bundles.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No bundles yet</CardTitle>
            <CardDescription>
              Create a tie-in bundle from a contract&rsquo;s detail page, or
              via the <span className="font-mono">createBundle</span> server
              action once the create form lands.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bundles.map((b) => (
            <Link
              key={b.id}
              href={`/dashboard/contracts/bundles/${b.id}`}
              className="block"
            >
              <Card className="transition-colors hover:border-primary">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate text-base">
                      {b.primaryContract.name}
                    </CardTitle>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {b.complianceMode}
                    </Badge>
                  </div>
                  <CardDescription className="truncate">
                    {b.primaryContract.vendor.name}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {b._count.members} member
                  {b._count.members === 1 ? "" : "s"}
                  {b.baseRate != null && (
                    <> · base {Number(b.baseRate).toFixed(1)}%</>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
