import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  createOrganizationWithOwner,
  getOrganization,
  getUserByEmail,
  getUserWithRelations,
  updateUser,
} from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import { sendOtpEmail, generateOtp } from '../lib/email.js';
import { createFirebaseCustomToken } from '../lib/firebase.js';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { logActivity } from '../lib/activity.js';
import { assertEmailAvailable } from '../lib/emailUnique.js';

const router = Router();

const registerSchema = z.object({
  businessName: z.string().min(2).max(120),
  ownerName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  phone: z.string().optional(),
  location: z.string().optional(),
});

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { businessName, ownerName, email, password, phone, location } = parsed.data;
  const emailCheck = await assertEmailAvailable(email, 'register');
  if (!emailCheck.ok) {
    res.status(409).json({ error: emailCheck.message, code: 'EMAIL_TAKEN' });
    return;
  }

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const { org } = await createOrganizationWithOwner({
      businessName,
      email,
      phone,
      location,
      ownerName,
      passwordHash,
      otpCode: otp,
      otpExpiresAt,
    });

    await sendOtpEmail(email, otp, businessName);
    res.status(201).json({
      message: 'Registration successful. Check your email for the activation code.',
      organizationId: org.id,
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'EMAIL_TAKEN') {
      res.status(409).json({ error: 'Email already registered', code: 'EMAIL_TAKEN' });
      return;
    }
    throw e;
  }
});

router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body as { email?: string; otp?: string };
  if (!email || !otp) {
    res.status(400).json({ error: 'Email and OTP required' });
    return;
  }
  const found = await getUserByEmail(email);
  if (!found || found.role !== 'OWNER') {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  if (found.otpCode !== otp.trim()) {
    res.status(400).json({ error: 'Invalid OTP' });
    return;
  }
  if (found.otpExpiresAt && new Date(found.otpExpiresAt) < new Date()) {
    res.status(400).json({ error: 'OTP expired. Request a new code.' });
    return;
  }

  await updateUser(found.id, {
    status: 'ACTIVE',
    emailVerified: true,
    otpCode: null,
    otpExpiresAt: null,
  });

  const full = await getUserWithRelations(found.id);
  const token = signToken({
    userId: found.id,
    organizationId: found.organizationId || '',
    role: found.role,
    substationId: null,
  });

  res.json({
    token,
    user: {
      id: found.id,
      name: found.name,
      email: found.email,
      role: found.role,
      organization: full?.organization,
    },
  });
});

router.post('/resend-otp', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'Email required' });
    return;
  }
  const user = await getUserByEmail(email);
  if (!user || user.emailVerified) {
    res.status(400).json({ error: 'Cannot resend OTP for this account' });
    return;
  }
  const org = user.organizationId ? await getOrganization(user.organizationId) : null;
  const otp = generateOtp();
  await updateUser(user.id, {
    otpCode: otp,
    otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });
  await sendOtpEmail(user.email, otp, org?.businessName ?? 'Bekye Swap');
  res.json({ message: 'OTP sent' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }
  const user = await getUserWithRelations(email.toLowerCase());
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  if (user.status === 'BLOCKED' || user.status === 'SUSPENDED') {
    res.status(403).json({ error: `Account is ${user.status.toLowerCase()}` });
    return;
  }
  if (user.role === 'OWNER' && (!user.emailVerified || user.status === 'PENDING')) {
    res.status(403).json({ error: 'Please verify your email first', needsVerification: true });
    return;
  }
  if (user.role === 'EMPLOYEE' && user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Employee account not active' });
    return;
  }
  if (user.role === 'EMPLOYEE' && !user.substationId) {
    res.status(403).json({
      error: 'Not assigned to a substation yet. Contact your administrator.',
    });
    return;
  }

  await updateUser(user.id, { lastLoginAt: new Date().toISOString() });

  const token = signToken({
    userId: user.id,
    organizationId: user.organizationId || '',
    role: user.role,
    substationId: user.substationId ?? null,
  });

  await logActivity(req, {
    organizationId: user.organizationId || '',
    userId: user.id,
    substationId: user.substationId,
    type: 'LOGIN',
    description: `${user.name} signed in (${user.role})`,
    metadata: { email: user.email, role: user.role },
  });

  const firebaseToken = await createFirebaseCustomToken(user.id);

  let hasOverdueBills = false;
  if (user.role === 'OWNER' && user.organizationId) {
    const count = await prisma.bill.count({
      where: { organizationId: user.organizationId, status: 'OVERDUE' },
    });
    hasOverdueBills = count > 0;
  }

  res.json({
    token,
    firebaseToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      role: user.role,
      status: user.status,
      substationId: user.substationId,
      substation: user.substation
        ? { id: user.substation.id, name: user.substation.name, code: user.substation.code, status: user.substation.status }
        : null,
      organization: user.organization
        ? { id: user.organization.id, businessName: user.organization.businessName }
        : undefined,
      hasOverdueBills,
    },
  });
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = await getUserWithRelations(req.user!.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const { passwordHash: _, otpCode: __, ...safe } = user;
  const firebaseToken = await createFirebaseCustomToken(user.id);

  let hasOverdueBills = false;
  if (user.role === 'OWNER' && user.organizationId) {
    const count = await prisma.bill.count({
      where: { organizationId: user.organizationId, status: 'OVERDUE' },
    });
    hasOverdueBills = count > 0;
  }

  res.json({ user: { ...safe, hasOverdueBills }, firebaseToken });
});

export default router;
