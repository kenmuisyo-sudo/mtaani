import { Router } from 'express';
import { z } from 'zod';
import {
  countOrganizations,
  countAllSwaps,
  getSystemSetting,
  upsertSystemSetting,
  listOrganizationsWithStats,
  updateOrganizationStatus,
  listAllUsers,
  createAdminUser,
} from '../lib/db.js';
import bcrypt from 'bcryptjs';
import { authMiddleware, requireSystemAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware, requireSystemAdmin);

// Get dashboard stats
router.get('/analytics', async (req, res) => {
  try {
    const orgsCount = await countOrganizations();
    const swapsCount = await countAllSwaps();
    const systemSetting = await getSystemSetting('CHARGE_PER_SWAP');
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
    await upsertSystemSetting('CHARGE_PER_SWAP', chargePerSwap.toString());
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    res.status(400).json({ error: 'Invalid settings data' });
  }
});

// Get all organizations with basic stats
router.get('/organizations', async (req, res) => {
  try {
    const orgs = await listOrganizationsWithStats();
    res.json({ organizations: orgs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// Update organization status
router.put('/organizations/:id/status', async (req, res) => {
  try {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BLOCKED']) }).parse(req.body);
    const org = await updateOrganizationStatus(req.params.id, status);
    res.json({ organization: org });
  } catch (error) {
    res.status(400).json({ error: 'Failed to update status' });
  }
});

// Get all users (staff) across organizations
router.get('/users', async (req, res) => {
  try {
    const { organizationId, substationId } = req.query;
    const users = await listAllUsers({
      organizationId: typeof organizationId === 'string' ? organizationId : undefined,
      substationId: typeof substationId === 'string' ? substationId : undefined,
    });
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create new System Admin
router.post('/users', async (req, res) => {
  try {
    const { email, password } = z.object({
      email: z.string().email(),
      password: z.string().min(8)
    }).parse(req.body);

    const existingUser = await listAllUsers().then(users => users.find(u => u.email === email));
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already taken by another user.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await createAdminUser(email, passwordHash);
    
    res.status(201).json({ message: 'System Admin created successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid data', details: error.errors });
    } else {
      res.status(500).json({ error: 'Failed to create admin user' });
    }
  }
});

export default router;
