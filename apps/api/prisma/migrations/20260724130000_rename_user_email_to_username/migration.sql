-- User table currently has no rows in any environment this has shipped to
-- (verified before writing this migration), so this is a plain drop+add
-- rather than a data-preserving rename.
DROP INDEX IF EXISTS "User_email_key";
ALTER TABLE "User" DROP COLUMN IF EXISTS "email";
ALTER TABLE "User" ADD COLUMN "username" TEXT;
UPDATE "User" SET "username" = "id" WHERE "username" IS NULL;
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
