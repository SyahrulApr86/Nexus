-- PRD §4: search must handle emoji and other symbols. to_tsvector('simple')
-- drops them, so we keep the distinct non-letter/non-punctuation characters
-- of each note in a tiny, trigram-indexed column. Leaks a handful of symbols,
-- never words; the content column itself stays pgp-encrypted (FR-026).
ALTER TABLE "Note" ADD COLUMN "contentSymbols" text NOT NULL DEFAULT '';
CREATE INDEX "Note_contentSymbols_trgm_idx"
  ON "Note" USING gin ("contentSymbols" gin_trgm_ops);
