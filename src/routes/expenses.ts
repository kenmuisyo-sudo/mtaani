import { Router } from 'express';
import { z } from 'zod';
import { createExpense, listExpenses } from '../lib/db.js';
import { authMiddleware, requireOwner } from '../middleware/auth.js';
import type { ExpenseType } from '../lib/types.js';

const router = Router();
router.use(authMiddleware);

const expenseSchema = z.object({
  substationId: z.string().min(1),
  type: z.enum(['RENT', 'SALARY', 'ELECTRICITY']),
  amount: z.number().positive(),
  datePaid: z.string().datetime(),
  employeeId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.post('/', requireOwner, async (req, res) => {
  try {
    const data = expenseSchema.parse(req.body);
    if (data.type === 'SALARY' && !data.employeeId) {
      res.status(400).json({ error: 'employeeId is required for SALARY expense' });
      return;
    }

    const exp = await createExpense({
      organizationId: req.user!.organizationId,
      substationId: data.substationId,
      type: data.type as ExpenseType,
      amount: data.amount,
      datePaid: data.datePaid,
      employeeId: data.employeeId ?? null,
      notes: data.notes ?? null,
    });
    res.status(201).json(exp);
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: e.errors });
    } else {
      res.status(500).json({ error: 'Failed to create expense' });
    }
  }
});

router.get('/', requireOwner, async (req, res) => {
  try {
    const { substationId, type, from, to } = req.query;
    
    const filters = {
      organizationId: req.user!.organizationId,
      ...(typeof substationId === 'string' && { substationId }),
      ...(typeof type === 'string' && { type: type as ExpenseType }),
      ...(typeof from === 'string' && { dateGte: new Date(from) }),
      ...(typeof to === 'string' && { dateLte: new Date(to) }),
    };

    const expenses = await listExpenses(filters, { orderDesc: true });
    res.json({ expenses });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list expenses' });
  }
});

export default router;
