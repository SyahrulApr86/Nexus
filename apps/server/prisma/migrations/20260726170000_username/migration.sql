-- Usernames become a second login identifier, so they must be unique.
-- Stored lowercase (like email) to avoid case-collision ambiguity.
ALTER TABLE "User" ADD COLUMN "username" text;

-- Backfill from the email local part, de-duplicated with a numeric suffix.
WITH candidates AS (
  SELECT id,
         regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_-]', '', 'g') AS base,
         row_number() OVER (
           PARTITION BY regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_-]', '', 'g')
           ORDER BY "createdAt"
         ) AS rn
  FROM "User"
)
UPDATE "User" u
SET "username" = CASE
  WHEN c.base = '' THEN 'user' || left(replace(u.id::text, '-', ''), 8)
  WHEN c.rn = 1 THEN c.base
  ELSE c.base || c.rn::text
END
FROM candidates c
WHERE u.id = c.id;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
