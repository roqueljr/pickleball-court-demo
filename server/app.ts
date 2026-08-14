import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { apiRouter } from "./routes/api.js";
import { errorHandler, notFound } from "./utils/errors.js";

export const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: config.appUrl, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
if (config.nodeEnv !== "production") app.get("/", (_req, res) => res.json({ name: "Rally Court Club API", version: "1.0.0" }));
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.apiRateLimit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => req.method === "OPTIONS" || req.path.startsWith("/health"),
  message: { success: false, message: "Too many API requests. Please wait a moment and try again.", errors: {} }
}), apiRouter);
if (config.nodeEnv === "production") {
  const clientDirectory = path.resolve(process.cwd(), "dist");
  if (!existsSync(clientDirectory)) throw new Error("Frontend build not found. Run npm run deploy:build before npm start.");
  app.use(express.static(clientDirectory, { index: false, maxAge: "1d" }));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(clientDirectory, "index.html")));
}
app.use(notFound);
app.use(errorHandler);
