/* global console, process, URL */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const sql = await readFile(new URL("../prisma/booking-overlap.sql", import.meta.url), "utf8");
  const blockStart = sql.indexOf("DO $$");
  if (blockStart < 0) throw new Error("The booking constraint SQL is missing its PostgreSQL DO block.");

  const statements = [sql.slice(0, blockStart).trim(), sql.slice(blockStart).trim()];
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);

  console.log("Booking overlap constraint is installed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to install booking overlap constraint.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
