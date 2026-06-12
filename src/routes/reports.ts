import { Router } from 'express';
import {
  aggregateSwaps,
  getOrganization,
  getSubstation,
  groupSwapsBySubstation,
  listSwaps,
  listExpenses,
  aggregateExpenses,
} from '../lib/db.js';
import { authMiddleware, resolveSubstationId } from '../middleware/auth.js';
import { buildSwapPdf } from '../services/pdfReport.js';
import { parseDateRange } from '../lib/dateRange.js';

const router = Router();
router.use(authMiddleware);

router.get('/summary', async (req, res) => {
  let from: Date, to: Date, label: string;
  try {
    ({ from, to, label } = parseDateRange(req.query as Record<string, unknown>));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid date range' });
    return;
  }
  const substationId = resolveSubstationId(
    req,
    typeof req.query.substationId === 'string' ? req.query.substationId : null
  );

  const filters = {
    organizationId: req.user!.organizationId,
    swappedAtGte: from,
    swappedAtLte: to,
    ...(substationId && { substationId }),
  };

  const expenseFilters = {
    organizationId: req.user!.organizationId,
    dateGte: from,
    dateLte: to,
    ...(substationId && { substationId }),
  };

  const [agg, substationBreakdown, transactions, expensesList, expensesTotal] = await Promise.all([
    aggregateSwaps(filters),
    groupSwapsBySubstation(filters),
    listSwaps(filters, { take: 200, orderDesc: true }),
    listExpenses(expenseFilters, { orderDesc: true }),
    aggregateExpenses(expenseFilters),
  ]);

  const bySubstation = await Promise.all(
    substationBreakdown.map(async (b) => ({
      substation: await getSubstation(b.substationId),
      swaps: b.count,
      revenue: b.totalCharged,
      stationShare: b.stationShare,
    }))
  );

  res.json({
    period: { from, to, label },
    totals: {
      swapCount: agg.count,
      grossRevenue: agg.totalCharged,
      companyShare: agg.companyShare,
      stationShare: agg.stationShare,
      energyPercent: agg.netPercent,
      totalExpenses: expensesTotal,
      profit: agg.totalCharged - expensesTotal,
    },
    bySubstation: bySubstation.map((b) => ({
      substation: b.substation ? { id: b.substation.id, name: b.substation.name, code: b.substation.code } : null,
      swaps: b.swaps,
      revenue: b.revenue,
      stationShare: b.stationShare,
    })),
    transactions,
    expenses: expensesList,
  });
});

router.get('/pdf', async (req, res) => {
  let from: Date, to: Date, label: string;
  try {
    ({ from, to, label } = parseDateRange(req.query as Record<string, unknown>));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid date range' });
    return;
  }
  const substationId = resolveSubstationId(
    req,
    typeof req.query.substationId === 'string' ? req.query.substationId : null
  );

  const org = await getOrganization(req.user!.organizationId);
  if (!org) {
    res.status(404).json({ error: 'Organization not found' });
    return;
  }

  let substationName: string | undefined;
  if (substationId) {
    const sub = await getSubstation(substationId);
    substationName = sub?.name;
  }

  const filters = {
    organizationId: req.user!.organizationId,
    swappedAtGte: from,
    swappedAtLte: to,
    ...(substationId && { substationId }),
  };

  const expenseFilters = {
    organizationId: req.user!.organizationId,
    dateGte: from,
    dateLte: to,
    ...(substationId && { substationId }),
  };

  const [swaps, agg, expensesList, expensesTotal] = await Promise.all([
    listSwaps(filters, { orderDesc: false }),
    aggregateSwaps(filters),
    listExpenses(expenseFilters, { orderDesc: false }),
    aggregateExpenses(expenseFilters),
  ]);

  const pdf = await buildSwapPdf(
    {
      title: 'Swap Report',
      organizationName: org.businessName,
      substationName,
      periodLabel: label,
      from,
      to,
      totals: {
        swapCount: agg.count,
        grossRevenue: agg.totalCharged,
        companyShare: agg.companyShare,
        stationShare: agg.stationShare,
        energyPercent: agg.netPercent,
        totalExpenses: expensesTotal,
        profit: agg.totalCharged - expensesTotal,
      },
    },
    swaps,
    expensesList
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="swap-report-${Date.now()}.pdf"`);
  res.send(pdf);
});

export default router;
