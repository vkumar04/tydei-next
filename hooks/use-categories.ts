"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/actions/categories"
import { useToastMutation } from "@/hooks/use-toast-mutation"

export function useCategoryTree() {
  return useQuery({
    queryKey: queryKeys.categories.tree(),
    queryFn: () => getCategoryTree(),
  })
}

export function useCreateCategory() {
  return useToastMutation(createCategory, {
    invalidate: [queryKeys.categories.all],
    success: "Category created",
    error: "Failed to create category",
  })
}

export function useUpdateCategory() {
  return useToastMutation(
    ({ id, data }: { id: string; data: Parameters<typeof updateCategory>[1] }) =>
      updateCategory(id, data),
    {
      invalidate: [queryKeys.categories.all],
      success: "Category updated",
      error: "Failed to update category",
    },
  )
}

export function useDeleteCategory() {
  return useToastMutation(deleteCategory, {
    invalidate: [queryKeys.categories.all],
    success: "Category deleted",
    error: "Failed to delete category",
  })
}
