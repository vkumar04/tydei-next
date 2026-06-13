-- CreateTable
CREATE TABLE "upload_header_event" (
    "id" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "fileName" TEXT,
    "headers" JSONB NOT NULL,
    "autoMapping" JSONB NOT NULL,
    "finalMapping" JSONB,
    "missingRequired" JSONB,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_header_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upload_header_event_surface_createdAt_idx" ON "upload_header_event"("surface", "createdAt");
