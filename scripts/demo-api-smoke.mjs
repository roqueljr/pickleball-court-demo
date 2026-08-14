/* global console, fetch, process */
// Demo/staging integration smoke test. It requires the seeded demo database and
// creates then cancels one test booking to verify concurrent booking safety.
process.env.NODE_ENV = "production";
process.env.APP_URL = "https://rally-smoke.example";
process.env.JWT_SECRET = "demo-api-smoke-secret-0123456789abcdef";
process.env.MAIL_HOST = "";
process.env.MAIL_USERNAME = "";
process.env.MAIL_PASSWORD = "";
process.env.EMAIL_API_URL = "https://email.invalid/messages";
process.env.EMAIL_API_KEY = "demo-api-smoke-email-key-0123456789";
process.env.EMAIL_FROM = "Rally Smoke <no-reply@rally-smoke.example>";

const { app } = await import("../dist-server/server/app.js");
const { prisma } = await import("../dist-server/server/db.js");
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to start the API smoke server.");
const baseUrl = `http://127.0.0.1:${address.port}`;

const accounts = {
  SUPER_ADMIN: "admin@example.com",
  ADMIN: "manager@example.com",
  STAFF: "staff@example.com",
  COACH: "coach@example.com",
  CUSTOMER: "customer@example.com",
  CUSTOMER_TWO: "player2@example.com"
};
const password = "ChangeMe123!";
let checks = 0;
const createdSmokeBookings = [];

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

async function request(path, options = {}, cookie) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(options.headers ?? {}) };
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function login(email) {
  const response = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  assert(response.status === 200, `Login failed for ${email}: HTTP ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(Boolean(cookie), `Login did not return a cookie for ${email}.`);
  return cookie;
}

function manilaDate(daysAhead) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day") + daysAhead)).toISOString().slice(0, 10);
}

async function findAvailableSmokeSlot(court) {
  // Pick a genuinely open future slot instead of assuming a fixed time is free.
  // This makes the test repeatable even if a prior interrupted run left a booking.
  for (let daysAhead = 14; daysAhead <= 30; daysAhead += 1) {
    const date = manilaDate(daysAhead);
    const response = await request(`/api/courts/${court.id}/availability?date=${date}&duration=60`);
    if (response.status !== 200) continue;
    const payload = await response.json();
    const slots = payload?.data?.slots ?? [];
    const preferred = slots.find((slot) => slot.available && slot.startTime >= "18:00")
      ?? slots.find((slot) => slot.available);
    if (preferred) {
      return { courtId: court.id, date, startTime: preferred.startTime, durationMinutes: 60, paymentMethod: "CASH" };
    }
  }
  throw new Error("No available future court slot was found for the concurrent booking smoke test.");
}

async function removeCreatedSmokeData() {
  if (!createdSmokeBookings.length) return;
  const bookingIds = createdSmokeBookings.map(({ id }) => id);
  const references = createdSmokeBookings.map(({ reference }) => reference);
  await prisma.$transaction(async (tx) => {
    const paymentIds = (await tx.payment.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } })).map(({ id }) => id);
    if (paymentIds.length) await tx.refund.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await tx.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await tx.promotionUsage.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await tx.equipmentRental.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await tx.notification.deleteMany({ where: { OR: references.map((reference) => ({ message: { contains: reference } })) } });
    await tx.auditLog.deleteMany({ where: { entity: "Booking", entityId: { in: bookingIds } } });
    await tx.booking.deleteMany({ where: { id: { in: bookingIds } } });
  });
  createdSmokeBookings.length = 0;
}

try {
  const cookies = Object.fromEntries(await Promise.all(Object.entries(accounts).map(async ([role, email]) => [role, await login(email)])));
  const roleCookies = Object.fromEntries(Object.entries(cookies).filter(([role]) => role !== "CUSTOMER_TWO"));
  const operations = new Set(["SUPER_ADMIN", "ADMIN", "STAFF"]);
  const admins = new Set(["SUPER_ADMIN", "ADMIN"]);
  const customerCapable = new Set(["SUPER_ADMIN", "ADMIN", "STAFF", "CUSTOMER"]);

  const rangeFrom = new Date().toISOString();
  const rangeTo = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const cases = [
    ["/api/auth/me", () => true],
    ["/api/bookings", (role) => customerCapable.has(role)],
    ["/api/coaching/sessions", () => true],
    ["/api/payments", (role) => customerCapable.has(role)],
    [`/api/calendar?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`, (role) => operations.has(role)],
    ["/api/admin/dashboard", (role) => operations.has(role)],
    ["/api/admin/users", (role) => admins.has(role)],
    ["/api/reports/summary", (role) => admins.has(role)],
    ["/api/growth/manage", (role) => operations.has(role)],
    ["/api/tournaments/manage/list", (role) => admins.has(role)],
    ["/api/equipment/rentals", (role) => customerCapable.has(role)],
    ["/api/products", (role) => operations.has(role)]
  ];

  for (const [role, cookie] of Object.entries(roleCookies)) {
    for (const [path, allowed] of cases) {
      const response = await request(path, {}, cookie);
      const expected = allowed(role) ? 200 : 403;
      assert(response.status === expected, `${role} ${path} returned HTTP ${response.status}; expected ${expected}.`);
    }
  }

  const courtResponse = await request("/api/courts");
  assert(courtResponse.status === 200, "Unable to load courts for booking conflict smoke test.");
  const { data: { courts } } = await courtResponse.json();
  const court = courts.find((item) => item.status === "AVAILABLE");
  assert(Boolean(court), "No available court found for booking conflict smoke test.");
  const bookingInput = await findAvailableSmokeSlot(court);
  const [first, second] = await Promise.all([
    request("/api/bookings", { method: "POST", body: JSON.stringify(bookingInput) }, cookies.CUSTOMER),
    request("/api/bookings", { method: "POST", body: JSON.stringify(bookingInput) }, cookies.CUSTOMER_TWO)
  ]);
  const attempts = await Promise.all([first, second].map(async (response, index) => {
    const payload = await response.json().catch(() => null);
    const cookie = index === 0 ? cookies.CUSTOMER : cookies.CUSTOMER_TWO;
    if (response.status === 201 && payload?.data?.booking?.id) {
      createdSmokeBookings.push({ id: payload.data.booking.id, reference: payload.data.booking.reference, cookie });
    }
    return { status: response.status, payload, cookie };
  }));
  assert(attempts.filter((attempt) => attempt.status === 201).length === 1, "Exactly one concurrent booking must succeed.");
  assert(attempts.filter((attempt) => attempt.status === 409).length === 1, "Exactly one concurrent booking must be rejected with HTTP 409.");

  const successful = createdSmokeBookings[0];
  const cancellation = await request(`/api/bookings/${successful.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Automated demo smoke cleanup" }) }, successful.cookie);
  assert(cancellation.status === 200, "Unable to clean up the booking smoke record.");

  console.log(`Demo API smoke passed: ${checks} checks, including role authorization and concurrent court booking protection.`);
} finally {
  try {
    await Promise.all(createdSmokeBookings.map(async ({ id, cookie }) => {
      try {
        await request(`/api/bookings/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Automated demo smoke cleanup" }) }, cookie);
      } catch {
        // Preserve the original test failure; this only prevents stray smoke data.
      }
    }));
    await removeCreatedSmokeData();
  } finally {
    server.close();
    await prisma.$disconnect();
  }
}
