export type UserRole = 'OWNER' | 'EMPLOYEE' | 'SYSTEM_ADMIN';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
export type SubstationStatus = 'ACTIVE' | 'INACTIVE';
export type ActivityType =
  | 'LOGIN'
  | 'SWAP_CREATED'
  | 'EMPLOYEE_CREATED'
  | 'EMPLOYEE_ASSIGNED'
  | 'EMPLOYEE_UNASSIGNED'
  | 'EMPLOYEE_STATUS_CHANGED'
  | 'EMPLOYEE_PASSWORD_RESET'
  | 'SUBSTATION_CREATED'
  | 'SUBSTATION_UPDATED'
  | 'REPORT_EXPORTED'
  | 'IMAGE_ANALYZED';

export interface Organization {
  id: string;
  businessName: string;
  email: string;
  phone?: string | null;
  location?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  organizationId?: string | null;
  substationId?: string | null;
  role: UserRole;
  status: UserStatus;
  name: string;
  email: string;
  passwordHash: string;
  phone?: string | null;
  emailVerified: boolean;
  otpCode?: string | null;
  otpExpiresAt?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
  organization?: Organization;
  substation?: Substation | null;
}

export interface Substation {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  location?: string | null;
  status: SubstationStatus;
  createdAt: string;
  updatedAt: string;
  _count?: { employees: number; swaps: number };
  employees?: Partial<User>[];
}

export interface Swap {
  id: string;
  organizationId: string;
  substationId: string;
  employeeId: string;
  vehicleId?: string | null;
  tukTukReg: string;
  incomingBarcode: string;
  incomingPct: number;
  outgoingBarcode: string;
  outgoingPct: number;
  netPercent: number;
  totalCharged: number;
  companyShare: number;
  stationShare: number;
  incomingImageUrl?: string | null;
  outgoingImageUrl?: string | null;
  ocrIncoming?: unknown;
  ocrOutgoing?: unknown;
  plateNumber?: string | null;
  notes?: string | null;
  swappedAt: string;
  createdAt: string;
  substation?: { name: string; code: string };
  employee?: { name: string };
}

export interface ActivityLog {
  id: string;
  organizationId: string;
  userId?: string | null;
  substationId?: string | null;
  type: ActivityType;
  description: string;
  metadata?: unknown;
  ipAddress?: string | null;
  createdAt: string;
  user?: { id?: string; name: string; email?: string; role?: string } | null;
  substation?: { id?: string; name: string; code?: string } | null;
}

export interface SwapAggregate {
  count: number;
  totalCharged: number;
  companyShare: number;
  stationShare: number;
  netPercent: number;
}

export interface SwapFilters {
  organizationId?: string;
  substationId?: string;
  employeeId?: string;
  swappedAtGte?: Date;
  swappedAtLte?: Date;
}

export type ExpenseType = 'RENT' | 'SALARY' | 'ELECTRICITY';

export interface Expense {
  id: string;
  organizationId: string;
  substationId: string;
  type: ExpenseType;
  amount: number;
  datePaid: string;
  employeeId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  substation?: { name: string; code: string };
  employee?: { name: string };
}

export interface ExpenseFilters {
  organizationId?: string;
  substationId?: string;
  type?: ExpenseType;
  dateGte?: Date;
  dateLte?: Date;
}
