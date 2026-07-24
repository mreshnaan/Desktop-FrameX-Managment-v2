-- Replaces the fixed Role enum with real, dynamic Role/Permission tables
-- (OWNER/ADMIN/CASHIER become protected "system roles", matching FrameX's
-- role model) and switches User auth from password to a PIN, for both
-- apps/web and apps/desktop. Verified before writing this migration: User
-- has 0 rows in the live database, so this is a clean rebuild, no
-- data-preserving transform needed.

CREATE TABLE "Permission" (
  "id"    TEXT NOT NULL,
  "key"   TEXT NOT NULL,
  "label" TEXT NOT NULL,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- Drop the old enum column and type before creating the new "Role" table --
-- a Postgres enum type and a table cannot share the same name at once.
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "Role";

CREATE TABLE "Role" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "isSystem"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

CREATE TABLE "RolePermission" (
  "roleId"       TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId")
);
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey"
  FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" ADD COLUMN "pinHash" TEXT NOT NULL;
ALTER TABLE "User" ADD COLUMN "roleId" TEXT NOT NULL;
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
