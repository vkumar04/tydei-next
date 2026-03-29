"use client"

import { useState } from "react"
import { ChevronRight, ChevronDown, Plus, Pencil, Trash2, FolderTree } from "lucide-react"
import type { ProductCategory } from "@prisma/client"
import type { CategoryNode } from "@/lib/actions/categories"
import { useCategoryTree, useDeleteCategory } from "@/hooks/use-categories"
import { CategoryFormDialog } from "@/components/facility/categories/category-form-dialog"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

function CategoryItem({
  node,
  onEdit,
  onDelete,
  onAddChild,
}: {
  node: CategoryNode
  onEdit: (cat: ProductCategory) => void
  onDelete: (cat: ProductCategory) => void
  onAddChild: (parentId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children.length > 0

  return (
    <div className="ml-4">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-1 py-1 group">
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6">
                {open ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
              </Button>
            </CollapsibleTrigger>
          ) : (
            <span className="size-6" />
          )}
          <span className="text-sm font-medium flex-1">{node.name}</span>
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => onAddChild(node.id)}
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => onEdit(node)}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => onDelete(node)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        {hasChildren && (
          <CollapsibleContent>
            {node.children.map((child) => (
              <CategoryItem
                key={child.id}
                node={child}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddChild={onAddChild}
              />
            ))}
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  )
}

export function CategoryTree() {
  const { data: categories, refetch } = useCategoryTree()
  const deleteMutation = useDeleteCategory()
  const [formOpen, setFormOpen] = useState(false)
  const [editCategory, setEditCategory] = useState<ProductCategory | undefined>()
  const [parentId, setParentId] = useState<string | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<ProductCategory | null>(null)

  const handleAddRoot = () => {
    setEditCategory(undefined)
    setParentId(undefined)
    setFormOpen(true)
  }

  const handleAddChild = (pId: string) => {
    setEditCategory(undefined)
    setParentId(pId)
    setFormOpen(true)
  }

  const handleEdit = (cat: ProductCategory) => {
    setEditCategory(cat)
    setParentId(undefined)
    setFormOpen(true)
  }

  if (!categories || categories.length === 0) {
    return (
      <EmptyState
        icon={FolderTree}
        title="No Categories"
        description="Create product categories to organize your COG data"
        action={
          <Button size="sm" onClick={handleAddRoot}>
            <Plus className="size-4" /> Add Category
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" onClick={handleAddRoot}>
          <Plus className="size-4" /> Add Category
        </Button>
      </div>

      <div className="rounded-md border p-3">
        {categories.map((node) => (
          <CategoryItem
            key={node.id}
            node={node}
            onEdit={handleEdit}
            onDelete={setDeleteTarget}
            onAddChild={handleAddChild}
          />
        ))}
      </div>

      <CategoryFormDialog
        category={editCategory}
        parentId={parentId}
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) {
            setEditCategory(undefined)
            setParentId(undefined)
          }
        }}
        onComplete={() => refetch()}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Category"
        description={`Delete "${deleteTarget?.name}"? Child categories will become root categories.`}
        onConfirm={async () => {
          if (deleteTarget) {
            await deleteMutation.mutateAsync(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        isLoading={deleteMutation.isPending}
        variant="destructive"
      />
    </div>
  )
}
