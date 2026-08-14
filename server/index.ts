import { app } from "./app.js";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { startAutomationScheduler } from "./services/automation.js";

const server = app.listen(config.port, () => console.log(`Rally API listening on http://localhost:${config.port}`));
startAutomationScheduler();

async function shutdown(signal: string) {
  console.log(`${signal} received; closing server.`);
  server.close(async () => { await prisma.$disconnect(); process.exit(0); });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
