import { config } from "../config.js";
import nodemailer from "nodemailer";

export type TransactionalEmail = { to: string; subject: string; text: string; html: string };

export async function sendTransactionalEmail(email: TransactionalEmail) {
  if (config.mailHost && config.mailUsername && config.mailPassword) {
    const transporter = nodemailer.createTransport({ host: config.mailHost, port: config.mailPort, secure: config.mailSecure, auth: { user: config.mailUsername, pass: config.mailPassword } });
    const result = await transporter.sendMail({ from: config.mailFrom, to: email.to, subject: email.subject, text: email.text, html: email.html });
    console.info(`[email] SMTP accepted message ${result.messageId} for ${email.to}`);
    return { delivered: true, development: config.nodeEnv !== "production", transport: "smtp" as const, messageId: result.messageId };
  }
  if (!config.emailApiUrl) {
    if (config.nodeEnv === "production") throw new Error("EMAIL_API_URL is required in production.");
    console.info(`[development email] To: ${email.to} | Subject: ${email.subject}\n${email.text}`);
    return { delivered: false, development: true, transport: "log" as const };
  }
  const response = await fetch(config.emailApiUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(config.emailApiKey ? { Authorization: `Bearer ${config.emailApiKey}` } : {}) }, body: JSON.stringify({ from: config.emailFrom, ...email }) });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json() as { message?: string; error?: { message?: string } };
      detail = payload.message ?? payload.error?.message ?? "";
    } catch {
      // Keep the status-only error when the provider does not return JSON.
    }
    throw new Error(`Email provider returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  return { delivered: true, development: false, transport: "api" as const };
}
