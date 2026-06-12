import express from 'express';
import cors from 'cors';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const helmet = require('helmet') as typeof import('helmet').default;
const rateLimit = require('express-rate-limit') as typeof import('express-rate-limit').default;
import authRoutes from './routes/auth.js';
import substationRoutes from './routes/substations.js';
import employeeRoutes from './routes/employees.js';
import swapRoutes from './routes/swaps.js';
import reportRoutes from './routes/reports.js';
import dashboardRoutes from './routes/dashboard.js';
import activityRoutes from './routes/activity.js';
import expensesRoutes from './routes/expenses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = process.env.UPLOAD_DIR ?? path.join(__dirname, '../uploads');

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/$/, '');
}

function getCorsOrigins(): string[] {
  const fromEnv = process.env.CORS_ORIGINS?.split(',').map(normalizeOrigin) ?? [];
  const single = process.env.FRONTEND_URL ? [normalizeOrigin(process.env.FRONTEND_URL)] : [];
  return [
    ...new Set([
      ...fromEnv,
      ...single,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://emobil.vercel.app',
      'https://mtaani-three.vercel.app',
    ]),
  ];
}

export const allowedOrigins = getCorsOrigins();

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.includes(normalized)) {
      callback(null, origin);
      return;
    }
    console.warn('CORS blocked:', origin, 'allowed:', allowedOrigins);
    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 204,
};

const app = express();

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadDir));

app.use(
  '/api/auth',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: { error: 'Too many requests' } }),
  authRoutes
);
app.use('/api/substations', substationRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/swaps', swapRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/expenses', expensesRoutes);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'bekye-swap-api',
    database: 'realtime',
    rtdbRoot: process.env.FIREBASE_RTD_ROOT ?? 'bekye_swap',
    storageRoot: process.env.FIREBASE_STORAGE_ROOT ?? 'bekye_swap',
    cors: allowedOrigins,
    runtime: process.env.VERCEL ? 'vercel' : 'node',
  });
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(normalizeOrigin(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (err.message.startsWith('CORS blocked')) {
    res.status(403).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

export default app;
