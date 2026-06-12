import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getUserById } from '../lib/db.js';
import type { UserRole, UserStatus } from '../lib/types.js';

export interface JwtPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
  substationId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload & {
        status: UserStatus;
        name: string;
        email: string;
      };
    }
  }
}

export function signToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');
  return jwt.sign(payload, secret, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const secret = process.env.JWT_SECRET!;
    const decoded = jwt.verify(token, secret) as JwtPayload;
    const user = await getUserById(decoded.userId);
    if (!user || user.status === 'BLOCKED') {
      res.status(403).json({ error: 'Account blocked or not found' });
      return;
    }
    if (user.status === 'SUSPENDED') {
      res.status(403).json({ error: 'Account suspended' });
      return;
    }
    if (user.role === 'OWNER' && !user.emailVerified) {
      res.status(403).json({ error: 'Email not verified' });
      return;
    }
    req.user = {
      userId: user.id,
      organizationId: user.organizationId || '',
      role: user.role,
      substationId: user.substationId ?? null,
      status: user.status,
      name: user.name,
      email: user.email,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'OWNER' && req.user?.role !== 'SYSTEM_ADMIN') {
    res.status(403).json({ error: 'Owner access required' });
    return;
  }
  next();
}

export function requireSystemAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'SYSTEM_ADMIN') {
    res.status(403).json({ error: 'System Admin access required' });
    return;
  }
  next();
}

export function resolveSubstationId(
  req: Request,
  requestedId?: string | null
): string | null {
  if (req.user?.role === 'EMPLOYEE') return req.user.substationId;
  return requestedId ?? req.user?.substationId ?? null;
}
