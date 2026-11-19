import express, { Request, Response, NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    const parsed = Number(process.argv[portArgIndex + 1]);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const envPort = Number(process.env.PORT);
  // In development, avoid colliding with NGINX_PORT (e.g. 8080) inherited from container env
  if (!isProduction && envPort && process.env.NGINX_PORT && envPort === Number(process.env.NGINX_PORT)) {
    return Number(process.env.DEFAULT_APP_PORT) || 4001;
  }

  return envPort || Number(process.env.DEFAULT_APP_PORT) || 4001;
}

const app = express();
const PORT = resolvePort();

// Health check endpoint (responds immediately on boot)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Express middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

let isReady = false;
const appRouter = express.Router();

// Wait for async initialization on non-health requests during initial boot
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!isReady && req.path !== '/api/health') {
    await readyPromise;
  }
  next();
});

app.use(appRouter);

async function initializeApp() {
  console.log('[Enterprise Server] Initializing database...');
  const { initDatabase } = await import('./server/db.js');
  await initDatabase();
  console.log('[Enterprise Server] Database initialized successfully.');

  // Mount versioned REST API
  const { apiRouter } = await import('./server/routes.js');
  appRouter.use('/api/v1', apiRouter);

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    // Development mode: mount Vite dev server as middleware
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : undefined,
        ws: disableHmr ? (false as const) : undefined,
        watch: disableHmr
          ? null
          : {
              ignored: [
                '**/data/**',
                '**/uploads/**',
                '**/exports/**',
                '**/backups/**',
                '**/tests/**',
                '**/prisma/**',
              ],
            },
      },
      appType: 'spa',
    });
    appRouter.use(vite.middlewares);
  } else {
    // Production mode: serve built static files from dist
    appRouter.use(express.static(path.join(__dirname, 'dist')));
    appRouter.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  // Centralized error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Enterprise Server Error]', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      timestamp: new Date().toISOString(),
    });
  });

  isReady = true;
}

const readyPromise = initializeApp().catch(err => {
  console.error('[Fatal] Failed to initialize server:', err);
  process.exit(1);
});

const server = http.createServer(app);
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('[Enterprise Server Socket Error]', err.message);
  if (err.code === 'EADDRINUSE') {
    process.exit(1);
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Enterprise Server] Listening on http://0.0.0.0:${PORT}`);
});
