-- CreateTable
CREATE TABLE "contract_extraction_cache" (
    "id" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "extracted" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "s3Key" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_extraction_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_extraction_cache_userId_fileHash_key" ON "contract_extraction_cache"("userId", "fileHash");

-- CreateIndex
CREATE INDEX "contract_extraction_cache_expiresAt_idx" ON "contract_extraction_cache"("expiresAt");

-- AddForeignKey
ALTER TABLE "contract_extraction_cache" ADD CONSTRAINT "contract_extraction_cache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
