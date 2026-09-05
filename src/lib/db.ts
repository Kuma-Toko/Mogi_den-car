import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// DATABASE_URL が未設定のとき、本番でローカルSQLiteパスへ静かにフォールバックすると
// 「空のDBに対して正常起動してしまう」ため、本番では明示的に落とす。
// 開発時のみ従来どおり prisma/dev.db を既定値として許可する。
function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set. Configure it to point at the Turso database (libsql://...?authToken=...).");
  }
  return "file:./prisma/dev.db";
}

function createClient() {
  const adapter = new PrismaLibSql({ url: resolveDatabaseUrl() });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
