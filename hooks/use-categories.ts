"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getCategoryTree,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/actions/categories"
import { toast } from "sonner"

export function useCategoryTree() {
  return useQuery({
    queryKey: queryKeys.categories.tree(),
    queryFn: () => getCategoryTree(),
  })
}

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categories.all })
      toast.success("Category created")
    },
    onError: (err) => toast.error(err.message || "Failed to create category"),
  })
}

export function useUpdateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: Parameters<typeof updateCategory>[1]
    }) => updateCategory(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categories.all })
      toast.success("Category updated")
    },
    onError: (err) => toast.error(err.message || "Failed to update category"),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteCategory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categories.all })
      toast.success("Category deleted")
    },
    onError: (err) => toast.error(err.message || "Failed to delete category"),
  })
}
