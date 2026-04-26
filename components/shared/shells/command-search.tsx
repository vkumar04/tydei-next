"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  FileSignature,
  Building2,
  Bell,
  ShoppingCart,
  Receipt,
  Search,
  BarChart3,
  FolderTree,
  Package,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { globalSearch, type GroupedSearchResults } from "@/lib/actions/search"

const TYPE_META = {
  contract: { icon: FileSignature, label: "Contract" },
  vendor: { icon: Building2, label: "Vendor" },
  alert: { icon: Bell, label: "Alert" },
  purchase_order: { icon: ShoppingCart, label: "PO" },
  invoice: { icon: Receipt, label: "Invoice" },
  report: { icon: BarChart3, label: "Report" },
  category: { icon: FolderTree, label: "Category" },
  cog_item: { icon: Package, label: "COG" },
} as const

const EMPTY: GroupedSearchResults = {
  contracts: [],
  vendors: [],
  alerts: [],
  purchaseOrders: [],
  invoices: [],
  reports: [],
  categories: [],
  cogItems: [],
}

export function CommandSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GroupedSearchResults>(EMPTY)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cmd+K / Ctrl+K keyboard shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  // Debounced search
  const handleSearch = useCallback((value: string) => {
    setQuery(value)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (value.trim().length < 2) {
      setResults(EMPTY)
      setLoading(false)
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await globalSearch(value)
        setResults(data)
      } catch {
        setResults(EMPTY)
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  function handleSelect(href: string) {
    setOpen(false)
    setQuery("")
    setResults(EMPTY)
    router.push(href)
  }

  const hasResults =
    results.contracts.length > 0 ||
    results.vendors.length > 0 ||
    results.alerts.length > 0 ||
    results.purchaseOrders.length > 0 ||
    results.invoices.length > 0 ||
    results.reports.length > 0 ||
    results.categories.length > 0 ||
    results.cogItems.length > 0

  return (
    <>
      {/* Search trigger — mirrors the original static input */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex h-9 w-full items-center rounded-lg border bg-background pl-9 pr-4 text-sm text-muted-foreground hover:bg-accent/50 transition-colors"
      >
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <span>Search contracts, vendors, COG, POs, invoices, alerts...</span>
        <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* Command dialog */}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Global Search"
        description="Search contracts, vendors, alerts, POs, invoices, COG items, categories, and report schedules"
      >
        <CommandInput
          placeholder="Search contracts, vendors, alerts..."
          value={query}
          onValueChange={handleSearch}
        />
        <CommandList>
          {loading && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Searching...
            </div>
          )}

          {!loading && query.trim().length >= 2 && !hasResults && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}

          {!loading && results.contracts.length > 0 && (
            <CommandGroup heading="Contracts">
              {results.contracts.map((item) => {
                const meta = TYPE_META[item.type]
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description ?? ""}`}
                    onSelect={() => handleSelect(item.href)}
                  >
                    <meta.icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {meta.label}
                    </Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {!loading && results.vendors.length > 0 && (
            <CommandGroup heading="Vendors">
              {results.vendors.map((item) => {
                const meta = TYPE_META[item.type]
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description ?? ""}`}
                    onSelect={() => handleSelect(item.href)}
                  >
                    <meta.icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {meta.label}
                    </Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {!loading && results.alerts.length > 0 && (
            <CommandGroup heading="Alerts">
              {results.alerts.map((item) => {
                const meta = TYPE_META[item.type]
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description ?? ""}`}
                    onSelect={() => handleSelect(item.href)}
                  >
                    <meta.icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {meta.label}
                    </Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {!loading && results.purchaseOrders.length > 0 && (
            <CommandGroup heading="Purchase Orders">
              {results.purchaseOrders.map((item) => {
                const meta = TYPE_META[item.type]
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description ?? ""}`}
                    onSelect={() => handleSelect(item.href)}
                  >
                    <meta.icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {meta.label}
                    </Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {!loading && results.invoices.length > 0 && (
            <CommandGroup heading="Invoices">
              {results.invoices.map((item) => {
                const meta = TYPE_META[item.type]
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description ?? ""}`}
                    onSelect={() => handleSelect(item.href)}
                  >
                    <meta.icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {meta.label}
                    </Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {!loading && results.cogItems.length > 0 && (
            <CommandGroup heading="COG Items">
              {results.cogItems.map((item) => {
                const meta = TYPE_META[item.type]
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description ?? ""}`}
                    onSelect={() => handleSelect(item.href)}
                  >
                    <meta.icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {meta.label}
                    </Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {!loading && results.categories.length > 0 && (
            <CommandGroup heading="Categories">
              {results.categories.map((item) => {
                const meta = TYPE_META[item.type]
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description ?? ""}`}
                    onSelect={() => handleSelect(item.href)}
                  >
                    <meta.icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {meta.label}
                    </Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}

          {!loading && results.reports.length > 0 && (
            <CommandGroup heading="Reports">
              {results.reports.map((item) => {
                const meta = TYPE_META[item.type]
                return (
                  <CommandItem
                    key={item.id}
                    value={`${item.name} ${item.description ?? ""}`}
                    onSelect={() => handleSelect(item.href)}
                  >
                    <meta.icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.description && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      {meta.label}
                    </Badge>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  )
}
