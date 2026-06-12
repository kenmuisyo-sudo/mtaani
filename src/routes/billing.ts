import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireOwner } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// Generate bills (Admin only)
router.post('/generate', async (req, res) => {
  if (req.user?.role !== 'SYSTEM_ADMIN') {
    res.status(403).json({ error: 'System Admin access required' });
    return;
  }
  
  try {
    const { month, year } = z.object({
      month: z.number().min(1).max(12),
      year: z.number().min(2020),
    }).parse(req.body);

    const systemSetting = await prisma.systemSetting.findUnique({ where: { key: 'CHARGE_PER_SWAP' } });
    const chargePerSwap = systemSetting ? Number(systemSetting.value) : 5;

    // Get all orgs
    const orgs = await prisma.organization.findMany();
    let generated = 0;

    for (const org of orgs) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1); // first day of next month

      const swapCount = await prisma.swap.count({
        where: {
          organizationId: org.id,
          swappedAt: {
            gte: startDate,
            lt: endDate,
          },
        },
      });

      if (swapCount > 0) {
        const amount = swapCount * chargePerSwap;
        
        // due date is 5th of next month
        const dueDate = new Date(year, month, 5);

        await prisma.bill.upsert({
          where: {
            organizationId_month_year: { organizationId: org.id, month, year },
          },
          update: {
            swapCount,
            amount,
          },
          create: {
            organizationId: org.id,
            month,
            year,
            swapCount,
            amount,
            dueDate,
          },
        });
        generated++;
      }
    }

    res.json({ message: `Successfully generated ${generated} bills for ${month}/${year}` });
  } catch (error) {
    res.status(400).json({ error: 'Failed to generate bills' });
  }
});

// List bills
router.get('/', async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'SYSTEM_ADMIN';
    const queryOrgId = typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined;
    const orgId = isAdmin ? queryOrgId : req.user?.organizationId ?? undefined;

    if (!isAdmin && req.user?.role !== 'OWNER') {
      res.status(403).json({ error: 'Owner access required' });
      return;
    }

    const bills = await prisma.bill.findMany({
      where: orgId ? { organizationId: orgId } : {},
      include: isAdmin ? { organization: { select: { businessName: true } } } : undefined,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    res.json({ bills });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bills' });
  }
});

// Pay a bill
router.post('/:id/pay', requireOwner, async (req, res) => {
  try {
    const { mpesaPhone } = z.object({ mpesaPhone: z.string().min(10) }).parse(req.body);
    
    const bill = await prisma.bill.findUnique({ where: { id: req.params.id as string } });
    if (!bill || bill.organizationId !== req.user?.organizationId) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }

    if (bill.status === 'PAID') {
      res.status(400).json({ error: 'Bill is already paid' });
      return;
    }

    // MOCK MPESA PAYMENT - In real life, trigger STK Push, wait for callback
    const receipt = 'MP' + Math.random().toString(36).substring(2, 10).toUpperCase();

    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        mpesaReceipt: receipt,
      },
    });

    res.json({ message: 'Payment successful', bill: updated });
  } catch (error) {
    res.status(400).json({ error: 'Failed to process payment' });
  }
});

export default router;
