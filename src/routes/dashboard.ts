import { Router } from 'express';
import {
  aggregateSwaps,
  countSwaps,
  countUsers,
  getSubstation,
  groupSwapsBySubstation,
  listActivities,
  listSubstations,
  listSwaps,
  aggregateExpenses,
} from '../lib/db.js';
import { authMiddleware, requireOwner } from '../middleware/auth.js';
import { dailySwapSeries } from '../lib/chartData.js';

const router = Router();
router.use(authMiddleware);

router.get('/owner', requireOwner, async (req, res) => {
  const orgId = req.user!.organizationId;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    substations,
    employeesCount,
    unassignedCount,
    todayAgg,
    weekSwaps,
    recentSwaps,
    recentActivity,
    topSubstations,
    chartDaily,
    todayExpenses,
  ] = await Promise.all([
    listSubstations(orgId),
    countUsers(orgId, { role: 'EMPLOYEE', status: 'ACTIVE' }),
    countUsers(orgId, { role: 'EMPLOYEE', substationId: null }),
    aggregateSwaps({ organizationId: orgId, swappedAtGte: startOfDay }),
    countSwaps({ organizationId: orgId, swappedAtGte: weekAgo }),
    listSwaps({ organizationId: orgId }, { take: 8 }),
    listActivities(orgId, undefined, { take: 12 }),
    groupSwapsBySubstation({ organizationId: orgId, swappedAtGte: startOfDay }),
    dailySwapSeries({ organizationId: orgId }, 7),
    aggregateExpenses({ organizationId: orgId, dateGte: startOfDay }),
  ]);

  const substationsCount = substations.filter((s) => s.status === 'ACTIVE').length;

  const topSubstationsToday = await Promise.all(
    topSubstations.map(async (t) => ({
      substation: await getSubstation(t.substationId),
      swaps: t.count,
      revenue: t.totalCharged,
    }))
  );

  res.json({
    substationsCount,
    employeesCount,
    unassignedCount,
    today: {
      swaps: todayAgg.count,
      revenue: todayAgg.totalCharged,
      expenses: todayExpenses,
      profit: todayAgg.totalCharged - todayExpenses,
      companyShare: todayAgg.companyShare,
      stationShare: todayAgg.stationShare,
      energyPercent: todayAgg.netPercent,
    },
    weekSwaps,
    recentSwaps,
    recentActivity,
    topSubstationsToday: topSubstationsToday.map((t) => ({
      substation: t.substation ? { name: t.substation.name, code: t.substation.code } : null,
      swaps: t.swaps,
      revenue: t.revenue,
    })),
    chartDaily,
  });
});

export default router;
