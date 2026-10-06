import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import {
  scrapeKnaben,
  formatStremioStreams,
  resolveStremioMedia,
  TorrentItem,
  ScraperConfig
} from './src/services/knabenService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Enable CORS for Stremio and cross-origin requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// Helper to parse configuration
function parseConfig(configStr?: string, queryParams: any = {}): ScraperConfig {
  const config: ScraperConfig = {
    minSeeds: queryParams.minSeeds ? parseInt(queryParams.minSeeds, 10) : 0,
    maxResults: queryParams.maxResults ? parseInt(queryParams.maxResults, 10) : 50,
    qualityFilter: queryParams.qualityFilter || 'all',
    sortBy: queryParams.sortBy || 'seeds'
  };

  if (configStr && configStr !== 'manifest.json') {
    if (configStr.includes('=')) {
      const params = new URLSearchParams(configStr);
      if (params.has('minSeeds')) config.minSeeds = parseInt(params.get('minSeeds')!, 10);
      if (params.has('maxResults')) config.maxResults = parseInt(params.get('maxResults')!, 10);
      if (params.has('qualityFilter')) config.qualityFilter = params.get('qualityFilter')!;
      if (params.has('sortBy')) config.sortBy = params.get('sortBy') as any;
    } else {
      try {
        const jsonStr = Buffer.from(configStr, 'base64').toString('utf-8');
        const parsed = JSON.parse(jsonStr);
        if (typeof parsed === 'object' && parsed !== null) {
          if (parsed.minSeeds !== undefined) config.minSeeds = parseInt(parsed.minSeeds, 10);
          if (parsed.maxResults !== undefined) config.maxResults = parseInt(parsed.maxResults, 10);
          if (parsed.qualityFilter) config.qualityFilter = parsed.qualityFilter;
          if (parsed.sortBy) config.sortBy = parsed.sortBy;
        }
      } catch {
        // Ignore invalid base64
      }
    }
  }

  return config;
}

// Generate Manifest JSON for Stremio v4
function getManifest(config?: ScraperConfig) {
  let name = 'Knaben Magnet Scraper';
  if (config && config.minSeeds && config.minSeeds > 0) {
    name += ` (${config.minSeeds}+ seeds)`;
  }

  return {
    id: 'com.knaben.magnet.scraper',
    version: '2.0.0',
    name: name,
    description: 'Trình cào magnet link trực tiếp từ Knaben.org cho Stremio. Sắp xếp torrents theo số lượng Seeds cao nhất.',
    resources: ['stream'],
    types: ['movie', 'series', 'other'],
    idPrefixes: ['kna', 'knaben', 'tt'],
    behaviorHints: {
      configurable: true
    },
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920',
    logo: 'https://knaben.org/favicon.ico'
  };
}

// 1. Manifest Routes
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=3600, public');
  const config = parseConfig(undefined, req.query);
  return res.json(getManifest(config));
});

app.get('/:config/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'max-age=3600, public');
  
  const configStr = req.params.config;
  if (['favicon.ico', 'api', 'dist', 'src', 'assets'].includes(configStr)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const config = parseConfig(configStr, req.query);
  return res.json(getManifest(config));
});

// 2. Stream Handler Routes
app.get('/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return handleStreamRequest(req, res, undefined);
});

app.get('/:config/stream/:type/:id.json', async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return handleStreamRequest(req, res, req.params.config);
});

async function handleStreamRequest(req: express.Request, res: express.Response, configStr?: string) {
  const { type, id } = req.params;
  const config = parseConfig(configStr, req.query);

  try {
    const mediaMeta = await resolveStremioMedia(type, id);
    const searchQuery = mediaMeta.primaryQuery;

    if (!searchQuery || !searchQuery.trim()) {
      return res.json({ streams: [] });
    }

    // Scrape Knaben directly for magnet links
    const torrents = await scrapeKnaben(searchQuery, config, mediaMeta);
    const streams = formatStremioStreams(torrents);

    return res.json({ streams });
  } catch (error) {
    console.error('[Stream Error]', error);
    return res.json({ streams: [] });
  }
}

// 3. REST API for Web UI Direct Knaben Magnet Search
app.get('/api/knaben/search', async (req, res) => {
  const q = ((req.query.q as string) || '').trim();
  if (!q) {
    return res.json({ success: true, count: 0, items: [] });
  }

  const config = parseConfig(undefined, req.query);

  try {
    const mediaMeta = await resolveStremioMedia('other', q);
    const searchQuery = mediaMeta.primaryQuery || q;
    const items = await scrapeKnaben(searchQuery, config, mediaMeta);

    return res.json({
      success: true,
      query: q,
      resolvedQuery: searchQuery,
      count: items.length,
      config,
      items
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: (err as Error).message || 'Lỗi khi cào magnet từ Knaben'
    });
  }
});

// 4. Server Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Knaben Magnet Scraper',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

const FILES_TO_PACKAGE = [
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'wrangler.toml',
  'server.ts',
  'cloudflare-worker.js',
  'deploy-cloudflare.bat',
  'deploy-cloudflare.sh',
  'start-local-pc.bat',
  'start-local-pc.sh',
  'README.md',
  'index.html',
  'metadata.json',
  'src/worker.ts',
  'src/services/knabenService.ts',
  'src/App.tsx',
  'src/main.tsx',
  'src/index.css'
];

// 5. Source code map for local client ZIP generation
app.get('/api/source-files', (req, res) => {
  try {
    const fileMap: Record<string, string> = {};
    for (const relPath of FILES_TO_PACKAGE) {
      const fullPath = path.resolve(__dirname, relPath);
      if (fs.existsSync(fullPath)) {
        fileMap[relPath] = fs.readFileSync(fullPath, 'utf-8');
      }
    }

    return res.json({ success: true, files: fileMap });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to read source files' });
  }
});

// 6. Direct Cloudflare Worker standalone code endpoint
app.get('/api/cloudflare-code', (req, res) => {
  try {
    const workerPath = path.resolve(__dirname, 'cloudflare-worker.js');
    if (fs.existsSync(workerPath)) {
      const code = fs.readFileSync(workerPath, 'utf-8');
      return res.json({ success: true, code });
    }
    return res.status(404).json({ success: false, error: 'File cloudflare-worker.js not found' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to read worker code' });
  }
});

// 7. Direct server-side ZIP download endpoint
app.get('/api/download-pc-zip', async (req, res) => {
  try {
    const zip = new JSZip();
    for (const relPath of FILES_TO_PACKAGE) {
      const fullPath = path.resolve(__dirname, relPath);
      if (fs.existsSync(fullPath)) {
        zip.file(relPath, fs.readFileSync(fullPath, 'utf-8'));
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="knaben-magnet-scraper-pc.zip"');
    res.setHeader('Content-Length', zipBuffer.length.toString());
    return res.send(zipBuffer);
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to generate ZIP download' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom'
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Knaben Magnet Scraper Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
