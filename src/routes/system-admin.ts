import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireSystemAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware, requireSystemAdmin);

// Get dashboard stats
router.get('/analytics', async (req, res) => {
  try {
    const orgsCount = await prisma.organization.count();
    const swapsCount = await prisma.swap.count();
    const systemSetting = await prisma.systemSetting.findUnique({ where: { key: 'CHARGE_PER_SWAP' } });
    const chargePerSwap = systemSetting ? Number(systemSetting.value) : 5;
    const totalExpectedRevenue = swapsCount * chargePerSwap;

    res.json({
      orgsCount,
      swapsCount,
      chargePerSwap,
      totalExpectedRevenue,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Update system settings
router.put('/settings', async (req, res) => {
  try {
    const { chargePerSwap } = z.object({ chargePerSwap: z.number().positive() }).parse(req.body);
    await prisma.systemSetting.upsert({
      where: { key: 'CHARGE_PER_SWAP' },
      update: { value: chargePerSwap.toString() },
      create: { key: 'CHARGE_PER_SWAP', value: chargePerSwap.toString() },
    });
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid settings data' });
  }
});

// Get all organizations with basic stats
router.get('/organizations', async (req, res) => {
  try {
    const orgs = await prisma.organization.findMany({
      include: {
        _count: {
          select: { users: true, substations: true, swaps: true, bills: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ organizations: orgs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// Update organization status
router.put('/organizations/:id/status', async (req, res) => {
  try {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BLOCKED']) }).parse(req.body);
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json({ organization: org });
  } catch (error) {
    res.status(400).json({ error: 'Failed to update status' });
  }
});

// Get all users (staff) across organizations
router.get('/users', async (req, res) => {
  try {
    const { organizationId, substationId } = req.query;
    const users = await prisma.user.findMany({
      where: {
        ...(organizationId && typeof organizationId === 'string' ? { organizationId } : {}),
        ...(substationId && typeof substationId === 'string' ? { substationId } : {}),
        role: { not: 'SYSTEM_ADMIN' },
      },
      include: {
        organization: { select: { businessName: true } },
        substation: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default router;
