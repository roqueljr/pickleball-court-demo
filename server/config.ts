import "dotenv/config";

const nodeEnv = process.env.NODE_ENV?.trim() || "development";
const rawAppUrl = process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || "http://localhost:5173";
let parsedAppUrl: URL;
try {
  parsedAppUrl = new URL(rawAppUrl);
} catch {
  throw new Error("APP_URL must be a valid absolute URL.");
}

if (parsedAppUrl.pathname !== "/" || parsedAppUrl.search || parsedAppUrl.hash) {
  throw new Error("APP_URL must contain only the application origin, without a path, query, or fragment.");
}

const appUrl = parsedAppUrl.origin;
const mailHost = process.env.MAIL_HOST?.trim() ?? "";
const mailUsername = process.env.MAIL_USERNAME?.trim() ?? "";
// Google displays app passwords in groups; whitespace is not part of the credential.
const mailPassword = process.env.MAIL_PASSWORD?.replace(/\s+/g, "") ?? "";
const emailApiUrl = process.env.EMAIL_API_URL?.trim() ?? "";
const emailApiKey = process.env.EMAIL_API_KEY?.trim() ?? "";
const smtpValuesPresent = Boolean(mailHost || mailUsername || mailPassword);
const smtpConfigured = Boolean(mailHost && mailUsername && mailPassword);
const apiValuesPresent = Boolean(emailApiUrl || emailApiKey);
const emailApiConfigured = Boolean(emailApiUrl && emailApiKey);

if (smtpValuesPresent && !smtpConfigured) {
  throw new Error("MAIL_HOST, MAIL_USERNAME, and MAIL_PASSWORD must all be set when SMTP is configured.");
}
if (apiValuesPresent && !emailApiConfigured && !smtpConfigured) {
  throw new Error("EMAIL_API_URL and EMAIL_API_KEY must both be set when the HTTP email provider is configured.");
}
if (emailApiConfigured && emailApiKey.length < 30 && !smtpConfigured) {
  throw new Error("EMAIL_API_KEY appears incomplete. Copy the full provider key shown when it is created.");
}
if (emailApiUrl) {
  try { new URL(emailApiUrl); } catch { throw new Error("EMAIL_API_URL must be a valid absolute URL."); }
}

if (nodeEnv === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be at least 32 characters in production.");
}
if (nodeEnv === "production" && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in production.");
}
if (nodeEnv === "production" && parsedAppUrl.protocol !== "https:") {
  throw new Error("APP_URL must use HTTPS in production.");
}
if (nodeEnv === "production" && !smtpConfigured && !emailApiConfigured) {
  throw new Error("Configure SMTP or the HTTP email provider before starting production.");
}
if (nodeEnv === "production" && emailApiConfigured && !process.env.EMAIL_FROM?.trim()) {
  throw new Error("EMAIL_FROM is required when the HTTP email provider is used in production.");
}

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  const value = Number(raw ? raw : fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
  return value;
}

export const config = {
  nodeEnv,
  port: positiveInteger("PORT", 4000),
  appUrl,
  jwtSecret: process.env.JWT_SECRET ?? "development-only-change-me",
  cookieName: "rally_access_token",
  accessTokenTtl: "15m",
  emailApiUrl,
  emailApiKey,
  emailFrom: process.env.EMAIL_FROM?.trim() || "Rally Court Club <no-reply@rallycourt.example>",
  mailHost,
  mailPort: positiveInteger("MAIL_PORT", 465),
  mailUsername,
  mailPassword,
  mailSecure: ["ssl", "true", "465"].includes((process.env.MAIL_SMTPSecure ?? "ssl").trim().toLowerCase()),
  mailFrom: process.env.MAIL_FROM?.trim() || process.env.EMAIL_FROM?.trim() || mailUsername,
  apiRateLimit: positiveInteger("API_RATE_LIMIT", nodeEnv === "production" ? 1200 : 10_000),
  authLoginRateLimit: positiveInteger("AUTH_LOGIN_RATE_LIMIT", 10),
  authRegistrationRateLimit: positiveInteger("AUTH_REGISTRATION_RATE_LIMIT", 10),
  authEmailRateLimit: positiveInteger("AUTH_EMAIL_RATE_LIMIT", 5),
  smtpConfigured,
  emailApiConfigured
} as const;
