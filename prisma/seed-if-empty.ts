import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { closeSeedDatabase, seedDemoData } from "./seed.js";

const probe = new PrismaClient();

async function main() {
  const existingUsers = await probe.user.count();
  if (existingUsers > 0) {
    console.log("Database already contains users; skipping demo seed.");
    return;
  }
  await seedDemoData();
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await probe.$disconnect();
  await closeSeedDatabase();
});
