-- AlterTable: distinguish a hand-entered rate from a label/note-only edit.
ALTER TABLE "medicare_rate_override" ADD COLUMN "rateEntered" BOOLEAN NOT NULL DEFAULT true;
