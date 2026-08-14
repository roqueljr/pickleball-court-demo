/* global console, fetch, process, setTimeout */
process.env.NODE_ENV = "production";
process.env.APP_URL = "https://rally.example.com";
process.env.JWT_SECRET = "production-smoke-only-secret-0123456789abcdef";
process.env.PORT = "4100";
process.env.EMAIL_API_URL = "https://email.invalid/messages";
process.env.EMAIL_API_KEY = "production-smoke-only-email-key-0123456789";
process.env.EMAIL_FROM = "Rally Smoke <no-reply@rally.example.com>";

let exitCode = 0;

try {
  await import("../dist-server/server/index.js");
  await new Promise((resolve) => setTimeout(resolve, 250));

  for (const path of ["/api/health", "/api/health/ready", "/", "/app/bookings", "/events"]) {
    const response = await fetch(`http://localhost:4100${path}`);
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`);
    console.log(`${response.status} ${response.headers.get("content-type") ?? "unknown"} ${path}`);
  }
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : "Production smoke test failed.");
} finally {
  process.exit(exitCode);
}
