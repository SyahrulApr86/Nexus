-- Derived tag names (FR-017/018): extracted from content at write time so
-- aggregation never decrypts. Same vocabulary-leak tradeoff as contentTsv.
ALTER TABLE "Note" ADD COLUMN "tags" text[] NOT NULL DEFAULT '{}';
CREATE INDEX "Note_tags_idx" ON "Note" USING gin ("tags");
