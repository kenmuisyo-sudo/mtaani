import { getRtdb, rtdbRef, RTDB_ROOT } from './firebase.js';
import type {
  ActivityLog,
  ActivityType,
  Organization,
  Substation,
  Swap,
  SwapAggregate,
  SwapFilters,
  User,
  UserRole,
  UserStatus,
} from './types.js';

// ── Helpers ──

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return getRtdb().ref().push().key!;
}

/** RTDB path keys cannot contain . # $ [ ] (and @ for emails). */
export function rtdbSafeKey(value: string): string {
  return value
    .replace(/\./g, '_dot_')
    .replace(/@/g, '_at_')
    .replace(/#/g, '_hash_')
    .replace(/\$/g, '_dollar_')
    .replace(/\[/g, '_lb_')
    .replace(/\]/g, '_rb_');
}

export function emailKey(email: string): string {
  return rtdbSafeKey(email.toLowerCase());
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

async function getRecord<T extends { id: string }>(
  subpath: string,
  id: string
): Promise<T | null> {
  const snap = await rtdbRef(`${subpath}/${id}`).once('value');
  if (!snap.exists()) return null;
  return { id, ...(snap.val() as object) } as T;
}

async function getAllRecords<T extends { id: string }>(subpath: string): Promise<T[]> {
  const snap = await rtdbRef(subpath).once('value');
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, object>;
  return Object.entries(val).map(([id, data]) => ({ id, ...data }) as T);
}

// ── Organizations ──

export async function createOrganizationWithOwner(input: {
  businessName: string;
  email: string;
  phone?: string;
  location?: string;
  ownerName: string;
  passwordHash: string;
  otpCode: string;
  otpExpiresAt: Date;
}): Promise<{ org: Organization; owner: User }> {
  const email = input.email.toLowerCase();
  const ek = emailKey(email);
  const existing = await rtdbRef(`users_by_email/${ek}`).once('value');
  if (existing.exists()) throw new Error('EMAIL_TAKEN');

  const orgId = newId();
  const userId = newId();
  const ts = nowIso();

  const orgData: Omit<Organization, 'id'> = {
    businessName: input.businessName,
    email,
    phone: input.phone ?? null,
    location: input.location ?? null,
    createdAt: ts,
    updatedAt: ts,
  };

  const userData: Omit<User, 'id'> = {
    organizationId: orgId,
    substationId: null,
    role: 'OWNER',
    status: 'PENDING',
    name: input.ownerName,
    email,
    passwordHash: input.passwordHash,
    phone: null,
    emailVerified: false,
    otpCode: input.otpCode,
    otpExpiresAt: input.otpExpiresAt.toISOString(),
    lastLoginAt: null,
    createdAt: ts,
    updatedAt: ts,
  };

  await getRtdb().ref().update({
    [`${RTDB_ROOT}/organizations/${orgId}`]: orgData,
    [`${RTDB_ROOT}/users/${userId}`]: userData,
    [`${RTDB_ROOT}/users_by_email/${ek}`]: { userId },
  });

  return {
    org: { id: orgId, ...orgData },
    owner: { id: userId, ...userData },
  };
}

export async function getOrganization(id: string): Promise<Organization | null> {
  return getRecord<Organization>('organizations', id);
}

// ── Users ──

export async function getUserByEmail(email: string): Promise<User | null> {
  const idx = await rtdbRef(`users_by_email/${emailKey(email)}`).once('value');
  if (!idx.exists()) return null;
  const userId = idx.val().userId as string;
  return getUserById(userId);
}

export async function getUserById(id: string): Promise<User | null> {
  return getRecord<User>('users', id);
}

export async function getUserWithRelations(idOrEmail: string): Promise<User | null> {
  const user =
    idOrEmail.includes('@')
      ? await getUserByEmail(idOrEmail)
      : await getUserById(idOrEmail);
  if (!user) return null;
  user.organization = (await getOrganization(user.organizationId)) ?? undefined;
  if (user.substationId) {
    user.substation = (await getSubstation(user.substationId)) ?? null;
  }
  return user;
}

export async function updateUser(id: string, data: Partial<User>): Promise<User | null> {
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const [k, v] of Object.entries(data)) {
    if (k === 'id' || k === 'organization' || k === 'substation' || k === '_count') continue;
    patch[k] = v === undefined ? null : v;
  }
  await rtdbRef(`users/${id}`).update(patch);
  return getUserById(id);
}

export async function createEmployee(input: {
  organizationId: string;
  substationId?: string | null;
  name: string;
  email: string;
  passwordHash: string;
  phone?: string;
}): Promise<User> {
  const email = input.email.toLowerCase();
  const ek = emailKey(email);
  const existing = await rtdbRef(`users_by_email/${ek}`).once('value');
  if (existing.exists()) throw new Error('EMAIL_TAKEN');

  const id = newId();
  const ts = nowIso();
  const userData: Omit<User, 'id'> = {
    organizationId: input.organizationId,
    substationId: input.substationId ?? null,
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    name: input.name,
    email,
    passwordHash: input.passwordHash,
    phone: input.phone ?? null,
    emailVerified: true,
    otpCode: null,
    otpExpiresAt: null,
    lastLoginAt: null,
    createdAt: ts,
    updatedAt: ts,
  };

  await getRtdb().ref().update({
    [`${RTDB_ROOT}/users/${id}`]: userData,
    [`${RTDB_ROOT}/users_by_email/${ek}`]: { userId: id },
  });

  return { id, ...userData };
}

export async function listEmployees(
  organizationId: string,
  filters?: { substationId?: string; unassigned?: boolean }
): Promise<User[]> {
  const all = await getAllRecords<User>('users');
  let users = all.filter((u) => u.organizationId === organizationId && u.role === 'EMPLOYEE');
  if (filters?.substationId) users = users.filter((u) => u.substationId === filters.substationId);
  if (filters?.unassigned) users = users.filter((u) => !u.substationId);

  for (const u of users) {
    if (u.substationId) {
      const sub = await getSubstation(u.substationId);
      u.substation = sub ? ({ name: sub.name, code: sub.code } as Substation) : null;
    }
    const swapCount = await countSwaps({ organizationId, employeeId: u.id });
    (u as User & { _count?: { swapsCreated: number } })._count = { swapsCreated: swapCount };
  }
  return users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function countUsers(
  organizationId: string,
  filters: { role?: UserRole; status?: UserStatus; substationId?: string | null }
): Promise<number> {
  const all = await getAllRecords<User>('users');
  return all.filter((u) => {
    if (u.organizationId !== organizationId) return false;
    if (filters.role && u.role !== filters.role) return false;
    if (filters.status && u.status !== filters.status) return false;
    if (filters.substationId === null && u.substationId) return false;
    return true;
  }).length;
}

// ── Substations ──

export async function getSubstation(id: string): Promise<Substation | null> {
  return getRecord<Substation>('substations', id);
}

export async function listSubstations(
  organizationId: string,
  filters?: { id?: string }
): Promise<Substation[]> {
  if (filters?.id) {
    const sub = await findSubstation(organizationId, filters.id);
    return sub ? [sub] : [];
  }

  const all = await getAllRecords<Substation>('substations');
  const subs = all.filter((s) => s.organizationId === organizationId);

  for (const s of subs) {
    const users = await getAllRecords<User>('users');
    const swaps = await getAllRecords<Swap>('swaps');
    s._count = {
      employees: users.filter((u) => u.substationId === s.id && u.role === 'EMPLOYEE').length,
      swaps: swaps.filter((sw) => sw.substationId === s.id).length,
    };
  }
  return subs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function findSubstation(
  organizationId: string,
  id: string
): Promise<Substation | null> {
  const sub = await getSubstation(id);
  if (!sub || sub.organizationId !== organizationId) return null;
  return sub;
}

export async function createSubstation(input: {
  organizationId: string;
  name: string;
  code: string;
  location?: string;
}): Promise<Substation> {
  const code = input.code.toUpperCase();
  const all = await getAllRecords<Substation>('substations');
  if (all.some((s) => s.organizationId === input.organizationId && s.code === code)) {
    throw new Error('DUPLICATE_CODE');
  }

  const id = newId();
  const ts = nowIso();
  const data: Omit<Substation, 'id'> = {
    organizationId: input.organizationId,
    name: input.name,
    code,
    location: input.location ?? null,
    status: 'ACTIVE',
    createdAt: ts,
    updatedAt: ts,
  };
  await rtdbRef(`substations/${id}`).set(data);
  return { id, ...data };
}

export async function updateSubstation(
  organizationId: string,
  id: string,
  data: Partial<Substation>
): Promise<Substation | null> {
  const sub = await findSubstation(organizationId, id);
  if (!sub) return null;
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (data.name) patch.name = data.name;
  if (data.location !== undefined) patch.location = data.location;
  if (data.status) patch.status = data.status;
  await rtdbRef(`substations/${id}`).update(patch);
  return getSubstation(id);
}

// ── Batteries & Vehicles ──

export async function upsertBattery(barcode: string): Promise<void> {
  const normalized = barcode.toUpperCase().replace(/\s/g, '');
  const key = rtdbSafeKey(normalized);
  const ref = rtdbRef(`batteries/${key}`);
  const snap = await ref.once('value');
  if (!snap.exists()) await ref.set({ barcode: normalized, createdAt: nowIso() });
}

export async function upsertVehicle(registration: string): Promise<{ id: string }> {
  const normalized = registration.toUpperCase().replace(/\s+/g, ' ').trim();
  const key = rtdbSafeKey(normalized);
  const ref = rtdbRef(`vehicles/${key}`);
  const snap = await ref.once('value');
  if (!snap.exists()) await ref.set({ registration: normalized, createdAt: nowIso() });
  return { id: normalized };
}

// ── Swaps ──

function filterSwaps(swaps: Swap[], filters: SwapFilters): Swap[] {
  return swaps.filter((s) => {
    if (filters.organizationId && s.organizationId !== filters.organizationId) return false;
    if (filters.substationId && s.substationId !== filters.substationId) return false;
    if (filters.employeeId && s.employeeId !== filters.employeeId) return false;
    if (filters.swappedAtGte && new Date(s.swappedAt) < filters.swappedAtGte) return false;
    if (filters.swappedAtLte && new Date(s.swappedAt) > filters.swappedAtLte) return false;
    return true;
  });
}

async function loadSwaps(filters?: SwapFilters): Promise<Swap[]> {
  const all = await getAllRecords<Swap>('swaps');
  return filters ? filterSwaps(all, filters) : all;
}

/** Firebase RTDB rejects `undefined` — omit those keys before write. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out)) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}

export async function createSwap(data: Omit<Swap, 'id' | 'createdAt'>): Promise<Swap> {
  const id = newId();
  const ts = nowIso();
  const record = stripUndefined({ ...data, createdAt: ts } as Record<string, unknown>);
  await rtdbRef(`swaps/${id}`).set(record);
  return { id, ...(record as Omit<Swap, 'id'>) };
}

export async function getSwap(
  id: string,
  organizationId: string,
  substationId?: string | null
): Promise<Swap | null> {
  const swap = await getRecord<Swap>('swaps', id);
  if (!swap || swap.organizationId !== organizationId) return null;
  if (substationId && swap.substationId !== substationId) return null;
  return enrichSwap(swap);
}

async function enrichSwap(swap: Swap): Promise<Swap> {
  const [sub, emp] = await Promise.all([
    getSubstation(swap.substationId),
    getUserById(swap.employeeId),
  ]);
  if (sub) swap.substation = { name: sub.name, code: sub.code };
  if (emp) swap.employee = { name: emp.name };
  return swap;
}

export async function listSwaps(
  filters: SwapFilters,
  opts?: { skip?: number; take?: number; orderDesc?: boolean }
): Promise<Swap[]> {
  let swaps = await loadSwaps(filters);
  swaps.sort((a, b) => {
    const diff = new Date(a.swappedAt).getTime() - new Date(b.swappedAt).getTime();
    return opts?.orderDesc === false ? diff : -diff;
  });
  if (opts?.skip) swaps = swaps.slice(opts.skip);
  if (opts?.take) swaps = swaps.slice(0, opts.take);
  return Promise.all(swaps.map(enrichSwap));
}

export async function countSwaps(filters: SwapFilters): Promise<number> {
  return (await loadSwaps(filters)).length;
}

export async function aggregateSwaps(filters: SwapFilters): Promise<SwapAggregate> {
  const swaps = await loadSwaps(filters);
  const agg: SwapAggregate = {
    count: 0,
    totalCharged: 0,
    companyShare: 0,
    stationShare: 0,
    netPercent: 0,
  };
  for (const s of swaps) {
    agg.count++;
    agg.totalCharged += num(s.totalCharged);
    agg.companyShare += num(s.companyShare);
    agg.stationShare += num(s.stationShare);
    agg.netPercent += num(s.netPercent);
  }
  return agg;
}

export async function groupSwapsBySubstation(
  filters: SwapFilters
): Promise<Array<{ substationId: string; count: number; totalCharged: number; stationShare: number }>> {
  const swaps = await loadSwaps(filters);
  const map = new Map<string, { count: number; totalCharged: number; stationShare: number }>();

  for (const s of swaps) {
    const cur = map.get(s.substationId) ?? { count: 0, totalCharged: 0, stationShare: 0 };
    cur.count++;
    cur.totalCharged += num(s.totalCharged);
    cur.stationShare += num(s.stationShare);
    map.set(s.substationId, cur);
  }

  return [...map.entries()].map(([substationId, v]) => ({ substationId, ...v }));
}

export async function getSwapsInRange(
  filters: SwapFilters
): Promise<Array<Pick<Swap, 'swappedAt' | 'totalCharged' | 'stationShare'>>> {
  const swaps = await loadSwaps(filters);
  return swaps.map((s) => ({
    swappedAt: s.swappedAt,
    totalCharged: num(s.totalCharged),
    stationShare: num(s.stationShare),
  }));
}

// ── Activity ──

export async function createActivity(input: {
  organizationId: string;
  userId?: string;
  substationId?: string | null;
  type: ActivityType;
  description: string;
  metadata?: unknown;
  ipAddress?: string;
}): Promise<void> {
  const id = newId();
  await rtdbRef(`activity_logs/${id}`).set({
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    substationId: input.substationId ?? null,
    type: input.type,
    description: input.description,
    metadata: input.metadata ?? null,
    ipAddress: input.ipAddress ?? null,
    createdAt: nowIso(),
  });
}

export async function listActivities(
  organizationId: string,
  filters?: { substationId?: string; userId?: string; employeeRole?: boolean },
  opts?: { skip?: number; take?: number }
): Promise<ActivityLog[]> {
  let items = (await getAllRecords<ActivityLog>('activity_logs')).filter(
    (a) => a.organizationId === organizationId
  );

  if (filters?.substationId) items = items.filter((a) => a.substationId === filters.substationId);
  if (filters?.userId) items = items.filter((a) => a.userId === filters.userId);

  if (filters?.employeeRole) {
    const employeeIds = new Set(
      (await getAllRecords<User>('users'))
        .filter((u) => u.organizationId === organizationId && u.role === 'EMPLOYEE')
        .map((u) => u.id)
    );
    items = items.filter((a) => a.userId && employeeIds.has(a.userId));
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (opts?.skip) items = items.slice(opts.skip);
  if (opts?.take) items = items.slice(0, opts.take);

  for (const a of items) {
    if (a.userId) {
      const u = await getUserById(a.userId);
      if (u) a.user = { id: u.id, name: u.name, email: u.email, role: u.role };
    }
    if (a.substationId) {
      const s = await getSubstation(a.substationId);
      if (s) a.substation = { id: s.id, name: s.name, code: s.code };
    }
  }
  return items;
}

export async function countActivities(
  organizationId: string,
  filters?: { substationId?: string; userId?: string }
): Promise<number> {
  let items = (await getAllRecords<ActivityLog>('activity_logs')).filter(
    (a) => a.organizationId === organizationId
  );
  if (filters?.substationId) items = items.filter((a) => a.substationId === filters.substationId);
  if (filters?.userId) items = items.filter((a) => a.userId === filters.userId);
  return items.length;
}

export async function listEmployeesWithStats(organizationId: string): Promise<User[]> {
  const employees = await listEmployees(organizationId);
  for (const e of employees) {
    const actCount = await countActivities(organizationId, { userId: e.id });
    (e as User & { _count?: { swapsCreated: number; activities: number } })._count = {
      swapsCreated: (e as User & { _count?: { swapsCreated: number } })._count?.swapsCreated ?? 0,
      activities: actCount,
    };
  }
  return employees.sort((a, b) => (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? ''));
}

export async function getSubstationEmployees(substationId: string): Promise<Partial<User>[]> {
  const all = await getAllRecords<User>('users');
  return all
    .filter((u) => u.substationId === substationId && u.role === 'EMPLOYEE')
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      status: u.status,
      lastLoginAt: u.lastLoginAt,
      _count: { swapsCreated: 0 },
    }));
}

export async function emailExists(email: string): Promise<boolean> {
  const snap = await rtdbRef(`users_by_email/${emailKey(email)}`).once('value');
  return snap.exists();
}
