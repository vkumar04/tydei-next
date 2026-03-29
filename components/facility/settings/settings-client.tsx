"use client"

import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { VendorList } from "@/components/facility/vendors/vendor-list"
import { VendorMappingTable } from "@/components/facility/vendors/vendor-mapping-table"
import { CategoryTree } from "@/components/facility/categories/category-tree"

export function SettingsClient() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage vendors, categories, and system configuration"
      />

      <Tabs defaultValue="vendors">
        <TabsList>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="mappings">Vendor Mappings</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="vendors" className="mt-4">
          <VendorList />
        </TabsContent>

        <TabsContent value="mappings" className="mt-4">
          <VendorMappingTable />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <CategoryTree />
        </TabsContent>
      </Tabs>
    </div>
  )
}
