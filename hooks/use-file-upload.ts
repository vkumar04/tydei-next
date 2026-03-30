"use client"

import { useState, useCallback } from "react"

interface UploadResult {
  url: string
  key: string
}

interface UseFileUploadReturn {
  upload: (file: File, folder?: string) => Promise<UploadResult>
  isUploading: boolean
  progress: number
}

export function useFileUpload(): UseFileUploadReturn {
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const upload = useCallback(
    async (file: File, folder = "uploads"): Promise<UploadResult> => {
      setIsUploading(true)
      setProgress(0)

      try {
        const formData = new FormData()
        formData.append("file", file)
        formData.append("folder", folder)

        setProgress(10)

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        })

        setProgress(90)

        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(
            (data as { error?: string }).error || `Upload failed (${response.status})`
          )
        }

        const result = (await response.json()) as UploadResult
        setProgress(100)
        return result
      } finally {
        setIsUploading(false)
      }
    },
    []
  )

  return { upload, isUploading, progress }
}
