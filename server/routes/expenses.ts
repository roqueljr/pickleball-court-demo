import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, authorize } from "../middleware/auth.js";

export const expensesRouter = Router();
expensesRouter.use(authenticate, authorize("SUPER_ADMIN", "ADMIN"));
const expenseInput = z.object({ category: z.enum(["RENT", "ELECTRICITY", "WATER", "INTERNET", "SALARIES", "MAINTENANCE", "EQUIPMENT", "MARKETING", "SUPPLIES", "OTHER"]), description: z.string().trim().min(2).max(250), amount: z.coerce.number().nonnegative(), date: z.coerce.date(), paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "GCASH", "CARD", "ONLINE_PAYMENT"]), receiptRef: z.string().trim().max(120).optional() });
expensesRouter.get("/", async (_req, res, next) => { try { const expenses = await prisma.expense.findMany({ include: { createdBy: { select: { firstName: true, lastName: true } } }, orderBy: { date: "desc" }, take: 200 }); res.json({ success: true, data: { expenses: expenses.map((expense) => ({ ...expense, amount: Number(expense.amount), date: expense.date.toISOString() })) } }); } catch (error) { next(error); } });
expensesRouter.post("/", async (req, res, next) => { try { const expense = await prisma.expense.create({ data: { ...expenseInput.parse(req.body), createdById: req.auth!.userId } }); res.status(201).json({ success: true, data: { expense: { ...expense, amount: Number(expense.amount), date: expense.date.toISOString() } } }); } catch (error) { next(error); } });
