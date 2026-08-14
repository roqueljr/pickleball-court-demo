import "dotenv/config";
import bcrypt from "bcryptjs";
import { CourtStatus, PrismaClient, RoleCode } from "@prisma/client";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();
const demoPassword = "ChangeMe123!";

function manilaDateAt(dayOffset: number, hour: number, minute = 0) {
  const manilaNow = new Date(Date.now() + 8 * 3_600_000);
  return new Date(Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate() + dayOffset, hour - 8, minute));
}

export async function seedDemoData() {
  const permissions = ["dashboard.view", "bookings.manage", "courts.manage", "customers.manage", "payments.manage", "reports.view", "settings.manage", "users.manage"];
  const permissionRows = await Promise.all(permissions.map((key) => prisma.permission.upsert({ where: { key }, update: {}, create: { key, description: key.replace(".", " ") } })));
  const roleNames: Record<RoleCode, string> = { SUPER_ADMIN: "Super Admin", ADMIN: "Admin", STAFF: "Staff", COACH: "Coach", CUSTOMER: "Customer" };
  const roles = {} as Record<RoleCode, { id: string }>;
  for (const code of Object.values(RoleCode)) {
    const role = await prisma.role.upsert({ where: { code }, update: { name: roleNames[code] }, create: { code, name: roleNames[code] } });
    roles[code] = role;
    if (code === "SUPER_ADMIN" || code === "ADMIN") {
      await Promise.all(permissionRows.map((permission) => prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } })));
    }
  }

  const passwordHash = await bcrypt.hash(demoPassword, 12);
  async function user(email: string, firstName: string, lastName: string, role: RoleCode, profile: "customer" | "staff" | "coach" | null = null, coachRate = 900) {
    const record = await prisma.user.upsert({
      where: { email },
      update: { firstName, lastName, passwordHash, emailVerifiedAt: new Date(), status: "ACTIVE" },
      create: { email, firstName, lastName, passwordHash, emailVerifiedAt: new Date(), status: "ACTIVE" }
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: record.id, roleId: roles[role].id } }, update: {}, create: { userId: record.id, roleId: roles[role].id } });
    if (profile === "customer") await prisma.customer.upsert({ where: { userId: record.id }, update: { deletedAt: null }, create: { userId: record.id } });
    if (profile === "staff") await prisma.staff.upsert({ where: { userId: record.id }, update: {}, create: { userId: record.id } });
    if (profile === "coach") await prisma.coach.upsert({ where: { userId: record.id }, update: { biography: "Certified coach focused on confidence and consistency.", experience: "8 years", certifications: "PPR Certified", hourlyRate: coachRate, status: "ACTIVE" }, create: { userId: record.id, biography: "Certified coach focused on confidence and consistency.", experience: "8 years", certifications: "PPR Certified", hourlyRate: coachRate } });
    return record;
  }

  const superAdmin = await user("admin@example.com", "Alex", "Santos", "SUPER_ADMIN");
  const manager = await user("manager@example.com", "Mia", "Reyes", "ADMIN");
  const staff = await user("staff@example.com", "Sam", "Cruz", "STAFF", "staff");
  await user("staff2@example.com", "Jordan", "Flores", "STAFF", "staff");
  await user("coach@example.com", "Taylor", "Dela Cruz", "COACH", "coach", 900);
  await user("coach2@example.com", "Morgan", "Navarro", "COACH", "coach", 1100);
  const customerProfiles = [
    ["customer@example.com", "Jamie", "Lim"], ["player2@example.com", "Casey", "Tan"], ["player3@example.com", "Avery", "Garcia"],
    ["player4@example.com", "Riley", "Mendoza"], ["player5@example.com", "Drew", "Villanueva"], ["player6@example.com", "Quinn", "Ramos"],
    ["player7@example.com", "Skyler", "Aquino"], ["player8@example.com", "Parker", "Torres"], ["player9@example.com", "Reese", "Castillo"],
    ["player10@example.com", "Cameron", "Bautista"]
  ] as const;
  for (const [email, firstName, lastName] of customerProfiles) await user(email, firstName, lastName, "CUSTOMER", "customer");
  const customers = await prisma.customer.findMany({ where: { user: { email: { in: customerProfiles.map(([email]) => email) } } }, include: { user: true }, orderBy: { user: { email: "asc" } } });

  const courtSeeds = [
    ["Court 1", "Indoor tournament court", "North Hall", true, 650], ["Court 2", "Indoor training court", "North Hall", true, 650],
    ["Court 3", "Open-air social court", "Garden Wing", false, 500], ["Court 4", "Open-air feature court", "Garden Wing", false, 500]
  ] as const;
  for (const [name, description, location, indoor, hourlyRate] of courtSeeds) await prisma.court.upsert({ where: { name }, update: { description, location, indoor, hourlyRate, status: CourtStatus.AVAILABLE }, create: { name, description, location, indoor, hourlyRate, status: CourtStatus.AVAILABLE, surfaceType: "Acrylic sport surface", features: ["LED lighting", "Benches", "Water station"] } });
  const courts = await prisma.court.findMany({ where: { name: { in: courtSeeds.map(([name]) => name) } }, orderBy: { name: "asc" } });

  const planSeeds = [
    { name: "Regular", description: "Pay as you play.", price: 0, discountPercent: 0, durationDays: 30, maximumBookings: 4, benefits: ["Book courts online", "Up to 4 active or upcoming bookings", "Member booking and payment history"] },
    { name: "Silver", description: "A little more play for a little less.", price: 799, discountPercent: 10, durationDays: 30, maximumBookings: 8, benefits: ["Everything in Regular", "10% court discount applied automatically", "Up to 8 active or upcoming bookings"] },
    { name: "Gold", description: "For members who keep the rally going.", price: 2499, discountPercent: 20, durationDays: 365, maximumBookings: 20, benefits: ["Everything in Silver", "20% court discount applied automatically", "Up to 20 active or upcoming bookings"] },
    { name: "Premium", description: "The club's highest court-saving plan.", price: 4999, discountPercent: 30, durationDays: 365, maximumBookings: null, benefits: ["Everything in Gold", "30% court discount applied automatically", "Unlimited active or upcoming bookings"] }
  ];
  for (const plan of planSeeds) await prisma.membershipPlan.upsert({ where: { name: plan.name }, update: { description: plan.description, price: plan.price, discountPercent: plan.discountPercent, durationDays: plan.durationDays, maximumBookings: plan.maximumBookings, bookingPrivileges: plan.benefits, isActive: true }, create: { name: plan.name, description: plan.description, price: plan.price, discountPercent: plan.discountPercent, durationDays: plan.durationDays, maximumBookings: plan.maximumBookings, bookingPrivileges: plan.benefits } });

  const categoryNames = ["Paddles", "Balls", "Apparel", "Drinks", "Accessories"];
  for (const name of categoryNames) await prisma.productCategory.upsert({ where: { name }, update: {}, create: { name } });
  const categories = new Map((await prisma.productCategory.findMany({ where: { name: { in: categoryNames } } })).map((category) => [category.name, category.id]));
  const productSeeds = [
    { sku: "BALL-001", name: "Rally outdoor balls", category: "Balls", price: 220, cost: 120, stock: 48, lowStockThreshold: 10 },
    { sku: "PADDLE-001", name: "Control composite paddle", category: "Paddles", price: 2450, cost: 1450, stock: 14, lowStockThreshold: 4 },
    { sku: "SHIRT-001", name: "Club performance shirt", category: "Apparel", price: 750, cost: 320, stock: 24, lowStockThreshold: 6 },
    { sku: "DRINK-001", name: "Club hydration", category: "Drinks", price: 80, cost: 30, stock: 80, lowStockThreshold: 12 },
    { sku: "GRIP-001", name: "Performance overgrip", category: "Accessories", price: 180, cost: 70, stock: 30, lowStockThreshold: 8 }
  ];
  for (const product of productSeeds) await prisma.product.upsert({ where: { sku: product.sku }, update: { name: product.name, categoryId: categories.get(product.category), price: product.price, cost: product.cost, lowStockThreshold: product.lowStockThreshold, status: "ACTIVE" }, create: { sku: product.sku, name: product.name, categoryId: categories.get(product.category), price: product.price, cost: product.cost, stock: product.stock, lowStockThreshold: product.lowStockThreshold } });
  const equipmentSeeds = [
    { id: "demo-paddle", name: "Demo paddle", quantity: 12, rentalPrice: 150 }, { id: "demo-ball-set", name: "Pickleball set", quantity: 20, rentalPrice: 60 },
    { id: "demo-shoes", name: "Court shoes", quantity: 8, rentalPrice: 200 }, { id: "demo-net", name: "Portable net", quantity: 4, rentalPrice: 350 }
  ];
  for (const item of equipmentSeeds) await prisma.equipment.upsert({ where: { id: item.id }, update: { name: item.name, rentalPrice: item.rentalPrice, status: "ACTIVE" }, create: { ...item, availableQuantity: item.quantity } });

  const settings = { business_name: "Rally Court Club", currency: "PHP", timezone: "Asia/Manila", tax_rate: 0.12, minimum_booking_minutes: 60, maximum_booking_minutes: 180, cancellation_hours: 12, refund_window_hours: 6, minimum_advance_minutes: 60, maximum_advance_days: 30, business_hours: "Daily 6:00 AM–10:00 PM" };
  for (const [key, value] of Object.entries(settings)) await prisma.businessSetting.upsert({ where: { key }, update: {}, create: { key, value } });

  const silver = await prisma.membershipPlan.findUniqueOrThrow({ where: { name: "Silver" } });
  const demoCustomer = customers.find((customer) => customer.user.email === "customer@example.com")!;
  const membership = await prisma.membership.upsert({ where: { id: "demo-membership-customer" }, update: { status: "ACTIVE", startDate: manilaDateAt(-7, 9), endDate: manilaDateAt(23, 9) }, create: { id: "demo-membership-customer", customerId: demoCustomer.id, planId: silver.id, status: "ACTIVE", startDate: manilaDateAt(-7, 9), endDate: manilaDateAt(23, 9) } });
  await prisma.payment.upsert({ where: { transactionReference: "DEMO-MEMBERSHIP-001" }, update: {}, create: { membershipId: membership.id, customerId: demoCustomer.id, amount: silver.price, finalAmount: silver.price, method: "GCASH", status: "PAID", transactionReference: "DEMO-MEMBERSHIP-001", paidAt: manilaDateAt(-7, 9), recordedById: staff.id } });

  const bookingSeeds = [
    { reference: "PB-DEMO-900001", customer: customers[0], court: courts[0], start: manilaDateAt(1, 10), minutes: 60, status: "CONFIRMED" as const, paid: true },
    { reference: "PB-DEMO-900002", customer: customers[1], court: courts[1], start: manilaDateAt(1, 14), minutes: 90, status: "PENDING" as const, paid: false },
    { reference: "PB-DEMO-900003", customer: customers[2], court: courts[2], start: manilaDateAt(2, 17), minutes: 120, status: "CONFIRMED" as const, paid: true },
    { reference: "PB-DEMO-900004", customer: customers[3], court: courts[0], start: manilaDateAt(-1, 9), minutes: 60, status: "COMPLETED" as const, paid: true },
    { reference: "PB-DEMO-900005", customer: customers[4], court: courts[3], start: manilaDateAt(-3, 18), minutes: 90, status: "COMPLETED" as const, paid: true },
    { reference: "PB-DEMO-900006", customer: customers[5], court: courts[3], start: manilaDateAt(4, 8), minutes: 60, status: "CANCELLED" as const, paid: false }
  ];
  for (const seed of bookingSeeds) {
    const subtotal = Number(seed.court.hourlyRate) * seed.minutes / 60;
    const tax = Math.round(subtotal * 0.12 * 100) / 100;
    const booking = await prisma.booking.upsert({ where: { reference: seed.reference }, update: {}, create: { reference: seed.reference, customerId: seed.customer.id, courtId: seed.court.id, createdById: superAdmin.id, startsAt: seed.start, endsAt: new Date(seed.start.getTime() + seed.minutes * 60_000), durationMinutes: seed.minutes, status: seed.status, subtotal, tax, total: subtotal + tax, ...(seed.status === "CANCELLED" ? { cancelledAt: new Date(), cancelledReason: "Demo cancellation" } : {}) } });
    if (!await prisma.payment.findFirst({ where: { bookingId: booking.id } })) await prisma.payment.create({ data: { bookingId: booking.id, customerId: seed.customer.id, amount: subtotal, tax, finalAmount: subtotal + tax, method: seed.paid ? "GCASH" : "BANK_TRANSFER", status: seed.paid ? "PAID" : seed.status === "CANCELLED" ? "FAILED" : "PENDING", transactionReference: seed.paid ? `DEMO-${seed.reference}` : null, paidAt: seed.paid ? new Date() : null, recordedById: seed.paid ? staff.id : null } });
    if (seed.status === "CONFIRMED") await prisma.bookingAccessPass.upsert({ where: { bookingId: booking.id }, update: { validFrom: new Date(seed.start.getTime() - 30 * 60_000), validUntil: new Date(seed.start.getTime() + seed.minutes * 60_000), status: "ACTIVE" }, create: { bookingId: booking.id, validFrom: new Date(seed.start.getTime() - 30 * 60_000), validUntil: new Date(seed.start.getTime() + seed.minutes * 60_000) } });
  }

  const expenseSeeds = [
    { id: "demo-expense-rent", category: "RENT" as const, description: "Monthly facility rent", amount: 65000, paymentMethod: "BANK_TRANSFER" as const, receiptRef: "DEMO-RENT" },
    { id: "demo-expense-electricity", category: "ELECTRICITY" as const, description: "Court lighting and utilities", amount: 12500, paymentMethod: "BANK_TRANSFER" as const, receiptRef: "DEMO-POWER" },
    { id: "demo-expense-supplies", category: "SUPPLIES" as const, description: "Cleaning and front-desk supplies", amount: 4200, paymentMethod: "CASH" as const, receiptRef: "DEMO-SUPPLIES" }
  ];
  for (const expense of expenseSeeds) await prisma.expense.upsert({ where: { id: expense.id }, update: {}, create: { ...expense, date: manilaDateAt(-2, 12), createdById: manager.id } });
  const drink = await prisma.product.findUniqueOrThrow({ where: { sku: "DRINK-001" } });
  await prisma.sale.upsert({ where: { id: "demo-sale-1" }, update: {}, create: { id: "demo-sale-1", customerId: demoCustomer.id, total: 160, paymentMethod: "CASH", items: { create: { productId: drink.id, quantity: 2, unitPrice: 80, total: 160 } } } });

  const promotionStart = manilaDateAt(-7, 0); const promotionEnd = manilaDateAt(60, 23, 59);
  await prisma.promotion.upsert({ where: { code: "PICKLE10" }, update: { discountPercent: 10, fixedDiscount: null, startDate: promotionStart, endDate: promotionEnd, usageLimit: 100, minimumPurchase: 500, applicableCourtIds: [], applicablePlanIds: [], isActive: true }, create: { code: "PICKLE10", discountPercent: 10, startDate: promotionStart, endDate: promotionEnd, usageLimit: 100, minimumPurchase: 500, applicableCourtIds: [], applicablePlanIds: [] } });
  await prisma.tournament.upsert({ where: { slug: "rally-community-doubles" }, update: {}, create: { title: "Rally Community Doubles", slug: "rally-community-doubles", description: "A welcoming round-robin tournament for developing and intermediate doubles teams.", format: "ROUND_ROBIN", registrationMode: "BOTH", skillLevel: "Beginner to Intermediate", startsAt: manilaDateAt(21, 8), endsAt: manilaDateAt(21, 18), registrationDeadline: manilaDateAt(18, 18), location: "Rally Court Club", entryFee: 1200, maxRegistrations: 24, teamSize: 2, featured: true, status: "PUBLISHED" } });

  for (const plan of [{ name: "Five Rally Pack", description: "Five prepaid court bookings valid for 90 days.", price: 2750, bookingCredits: 5, validityDays: 90 }, { name: "Ten Rally Pack", description: "Ten prepaid court bookings with the best package value.", price: 5000, bookingCredits: 10, validityDays: 180 }]) await prisma.packagePlan.upsert({ where: { name: plan.name }, update: plan, create: plan });
  const firstCourt = courts[0];
  if (!await prisma.dynamicPricingRule.findFirst({ where: { name: "Weekday afternoon boost" } })) await prisma.dynamicPricingRule.create({ data: { name: "Weekday afternoon boost", startTime: "13:00", endTime: "16:00", adjustmentPercent: -15, minimumLeadHours: 2, isActive: true } });
  if (!await prisma.league.findFirst({ where: { name: "Rally Club Ladder" } })) await prisma.league.create({ data: { name: "Rally Club Ladder", description: "A five-week skill-based ladder with local ratings and weekly match results.", skillMin: 2, skillMax: 5, startsAt: manilaDateAt(7, 8), endsAt: manilaDateAt(42, 18), maxPlayers: 24, entryFee: 500, status: "REGISTRATION_OPEN" } });
  const openPlayStart = manilaDateAt(3, 18); const openPlayEnd = new Date(openPlayStart.getTime() + 90 * 60_000);
  if (!await prisma.openPlay.findFirst({ where: { title: "Social Doubles Open Play", startsAt: openPlayStart } })) await prisma.openPlay.create({ data: { courtId: firstCourt.id, createdById: superAdmin.id, title: "Social Doubles Open Play", startsAt: openPlayStart, endsAt: openPlayEnd, skillMin: 2, skillMax: 4, capacity: 4, pricePerPlayer: 225, notes: "Paddles are available for first-time players." } });
  for (const campaign of [{ name: "30-day player win-back", kind: "WIN_BACK" as const, subject: "Your next rally is waiting", message: "It has been a while since your last game. See current open plays and available courts.", actionUrl: "/app/growth", triggerDays: 30 }, { name: "Membership renewal reminder", kind: "MEMBERSHIP_EXPIRY" as const, subject: "Your membership is nearing renewal", message: "Review your membership benefits and renew before your current plan expires.", actionUrl: "/app/memberships", triggerDays: 14 }]) if (!await prisma.automationCampaign.findFirst({ where: { name: campaign.name } })) await prisma.automationCampaign.create({ data: { ...campaign, createdById: superAdmin.id } });

  for (const customer of customers) await prisma.customer.update({ where: { id: customer.id }, data: { skillRating: customer.id === demoCustomer.id ? 3.25 : 2.5, marketingConsent: true, ...(customer.id === demoCustomer.id ? { walletBalance: 500 } : {}), lastActivityAt: new Date() } });
  if (!await prisma.walletTransaction.findFirst({ where: { customerId: demoCustomer.id } })) await prisma.walletTransaction.create({ data: { customerId: demoCustomer.id, type: "CREDIT", amount: 500, balanceAfter: 500, description: "Demo welcome wallet credit" } });
  if (!await prisma.notification.findFirst({ where: { userId: demoCustomer.userId, title: "Welcome to Rally Court Club" } })) await prisma.notification.create({ data: { userId: demoCustomer.userId, customerId: demoCustomer.id, type: "SYSTEM", title: "Welcome to Rally Court Club", message: "Your demo account is ready. Try booking a court or joining open play.", actionUrl: "/app" } });
  await prisma.auditLog.create({ data: { userId: superAdmin.id, action: "SEED_COMPLETED", entity: "SYSTEM", metadata: { demo: true } } });
  console.log(`Seeded Rally Court Club. Demo password: ${demoPassword}`);
}

export async function closeSeedDatabase() {
  await prisma.$disconnect();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void seedDemoData().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }).finally(closeSeedDatabase);
}
