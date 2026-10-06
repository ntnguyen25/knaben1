/**
 * Knaben Stremio Addon - Cloudflare Worker (Standalone 1-File Edition)
 * Tự động cào Magnet links từ Knaben.org, Apibay, SolidTorrents & sắp xếp Seeds cao nhất
 * 
 * Hướng dẫn triển khai nhanh trên Cloudflare Dashboard (Không cần cài phần mềm):
 * 1. Đăng nhập https://dash.cloudflare.com -> Chọn "Workers & Pages" -> "Create Application" -> "Create Worker".
 * 2. Đặt tên (VD: knaben-stremio) -> Nhấn "Deploy".
 * 3. Chọn "Edit Code" -> Xóa hết code cũ và DÁN TOÀN BỘ file này vào -> Nhấn "Save and deploy".
 * 4. Copy URL Worker (VD: https://knaben-stremio.yourname.workers.dev/manifest.json) và dán vào Stremio!
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function parseSizeBytes(sizeStr) {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/([\d.]+)\s*([a-zA-Z]+)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit.startsWith('T')) return num * 1024 * 1024 * 1024 * 1024;
  if (unit.startsWith('G')) return num * 1024 * 1024 * 1024;
  if (unit.startsWith('M')) return num * 1024 * 1024;
  if (unit.startsWith('K')) return num * 1024;
  return num;
}

function detectQualityTags(title) {
  const t = title.toUpperCase();
  const is4k = t.includes('4K') || t.includes('2160P') || t.includes('UHD');
  const is1080p = t.includes('1080P') || t.includes('FHD');
  const is720p = t.includes('720P') || (t.includes('HD') && !is1080p && !is4k);
  const isHdr = t.includes('HDR') || t.includes('VISION') || t.includes('DV') || t.includes('HDR10');
  const isRemux = t.includes('REMUX');

  let mainQuality = 'SD';
  if (is4k) mainQuality = '4K 2160p';
  else if (is1080p) mainQuality = '1080p';
  else if (is720p) mainQuality = '720p';

  return { is4k, is1080p, is720p, isHdr, isRemux, mainQuality };
}

function extractInfoHash(magnet) {
  if (!magnet) return '';
  const match = magnet.match(/urn:btih:([a-fA-F0-9]{40})/i) || magnet.match(/urn:btih:([a-zA-Z2-7]{32})/i);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }
  return '';
}

function parseConfig(configStr, searchParams) {
  const config = {
    minSeeds: searchParams?.get('minSeeds') ? parseInt(searchParams.get('minSeeds'), 10) : 0,
    maxResults: searchParams?.get('maxResults') ? parseInt(searchParams.get('maxResults'), 10) : 50,
    qualityFilter: searchParams?.get('qualityFilter') || 'all',
    sortBy: searchParams?.get('sortBy') || 'seeds',
  };

  if (configStr && configStr !== 'manifest.json') {
    if (configStr.includes('=')) {
      const params = new URLSearchParams(configStr);
      if (params.has('minSeeds')) config.minSeeds = parseInt(params.get('minSeeds'), 10);
      if (params.has('maxResults')) config.maxResults = parseInt(params.get('maxResults'), 10);
      if (params.has('qualityFilter')) config.qualityFilter = params.get('qualityFilter');
      if (params.has('sortBy')) config.sortBy = params.get('sortBy');
    } else {
      try {
        const jsonStr = atob(configStr);
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

function getManifest(config) {
  let name = 'Knaben Magnet Scraper (Cloudflare)';
  if (config && config.minSeeds && config.minSeeds > 0) {
    name += ` (${config.minSeeds}+ seeds)`;
  }

  return {
    id: 'com.knaben.magnet.scraper.cf',
    version: '2.1.0',
    name: name,
    description: 'Trình cào magnet link trực tiếp từ Knaben.org cho Stremio trên Cloudflare Workers. Tốc độ cao 24/7, sắp xếp theo số lượng seeds.',
    resources: ['stream'],
    types: ['movie', 'series', 'other'],
    idPrefixes: ['kna', 'knaben', 'tt'],
    behaviorHints: {
      configurable: true,
    },
    background: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=1920',
    logo: 'https://knaben.org/favicon.ico',
  };
}

// Scrape Knaben HTML mirror
async function fetchKnabenMirror(mirror, encodedQuery) {
  try {
    const res = await fetch(`${mirror}/q/${encodedQuery}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const html = await res.text();
    if (!html) return [];

    const items = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const rowContent = rowMatch[1];
      const magnetMatch = rowContent.match(/href="(magnet:\?[^"]+)"/i);
      if (!magnetMatch) continue;

      const magnetLink = magnetMatch[1].replace(/&amp;/g, '&');
      const infoHash = extractInfoHash(magnetLink);
      if (!infoHash) continue;

      let title = '';
      const titleLinkMatch = rowContent.match(/<a[^>]*href="[^"]*\/details\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
      if (titleLinkMatch) {
        title = titleLinkMatch[1].replace(/<[^>]+>/g, '').trim();
      }

      if (!title) {
        const dnMatch = magnetLink.match(/dn=([^&]+)/);
        if (dnMatch) {
          try {
            title = decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ');
          } catch {
            title = dnMatch[1].replace(/\+/g, ' ');
          }
        }
      }
      if (!title) continue;

      let seeds = 0;
      let leeches = 0;
      const seedMatch = rowContent.match(/class="[^"]*(?:seeds|seeders|green|text-success)[^"]*"[^>]*>([\s\S]*?)<\//i);
      if (seedMatch) {
        seeds = parseInt(seedMatch[1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim(), 10) || 0;
      }

      const leechMatch = rowContent.match(/class="[^"]*(?:leeches|leechers|red|text-danger)[^"]*"[^>]*>([\s\S]*?)<\//i);
      if (leechMatch) {
        leeches = parseInt(leechMatch[1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim(), 10) || 0;
      }

      if (seeds === 0) {
        const textOnly = rowContent.replace(/<[^>]+>/g, ' ');
        const slMatch = textOnly.match(/(\d+)\s*[\/|]\s*(\d+)/);
        if (slMatch) {
          seeds = parseInt(slMatch[1], 10) || 0;
          leeches = parseInt(slMatch[2], 10) || 0;
        }
      }

      let sizeStr = '';
      const sizeMatch = rowContent.match(/\b(\d+(?:\.\d+)?\s*(?:GiB|MiB|KiB|TiB|GB|MB|KB|TB))\b/i);
      if (sizeMatch) sizeStr = sizeMatch[1];

      const quality = detectQualityTags(title);

      items.push({
        id: `knaben-${infoHash}`,
        title,
        infoHash,
        magnet: magnetLink,
        seeds,
        leeches,
        size: sizeStr || 'N/A',
        sizeBytes: parseSizeBytes(sizeStr),
        category: 'Knaben.org',
        source: 'Knaben.org',
        quality: quality.mainQuality,
        is4k: quality.is4k,
        is1080p: quality.is1080p,
        is720p: quality.is720p,
        isHdr: quality.isHdr,
        isRemux: quality.isRemux,
      });
    }

    return items;
  } catch {
    return [];
  }
}

// Backup Apibay Torrent Engine
async function fetchApibay(query) {
  try {
    const res = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((item) => item.info_hash && item.name && item.info_hash !== '0000000000000000000000000000000000000000')
      .map((item) => {
        const infoHash = item.info_hash.toLowerCase();
        const seeds = parseInt(item.seeders, 10) || 0;
        const leeches = parseInt(item.leechers, 10) || 0;
        const sizeBytes = parseInt(item.size, 10) || 0;
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
        const sizeStr = sizeBytes > 1073741824 ? `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : `${sizeMB} MB`;
        const title = item.name;
        const magnet = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce`;
        const quality = detectQualityTags(title);

        return {
          id: `apibay-${infoHash}`,
          title,
          infoHash,
          magnet,
          seeds,
          leeches,
          size: sizeStr,
          sizeBytes,
          category: 'Knaben Torrent Index',
          source: 'Knaben Engine (Apibay)',
          quality: quality.mainQuality,
          is4k: quality.is4k,
          is1080p: quality.is1080p,
          is720p: quality.is720p,
          isHdr: quality.isHdr,
          isRemux: quality.isRemux,
        };
      });
  } catch {
    return [];
  }
}

// Backup SolidTorrents Engine
async function fetchSolidTorrents(query) {
  try {
    const res = await fetch(`https://solidtorrents.to/api/v1/search?q=${encodeURIComponent(query)}&category=all`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json || !Array.isArray(json.results)) return [];

    return json.results
      .map((t) => {
        const infoHash = t.infohash?.toLowerCase();
        if (!infoHash) return null;
        const title = t.title;
        const seeds = parseInt(t.swarm?.seeders, 10) || 0;
        const leeches = parseInt(t.swarm?.leechers, 10) || 0;
        const sizeBytes = parseInt(t.size, 10) || 0;
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
        const sizeStr = sizeBytes > 1073741824 ? `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB` : `${sizeMB} MB`;
        const quality = detectQualityTags(title);

        return {
          id: `solid-${infoHash}`,
          title,
          infoHash,
          magnet: t.magnet || `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`,
          seeds,
          leeches,
          size: sizeStr,
          sizeBytes,
          category: t.category || 'Knaben Torrent Index',
          source: 'Knaben Engine (Solid)',
          quality: quality.mainQuality,
          is4k: quality.is4k,
          is1080p: quality.is1080p,
          is720p: quality.is720p,
          isHdr: quality.isHdr,
          isRemux: quality.isRemux,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function scrapeKnaben(query, config = {}) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const minSeeds = config.minSeeds ?? 0;
  const maxResults = config.maxResults ?? 50;
  const qualityFilter = config.qualityFilter || 'all';
  const sortBy = config.sortBy || 'seeds';

  const encodedQuery = encodeURIComponent(cleanQuery);
  const items = [];

  const mirrors = [
    fetchKnabenMirror('https://knaben.org', encodedQuery),
    fetchKnabenMirror('https://knaben.eu', encodedQuery),
    fetchApibay(cleanQuery),
    fetchSolidTorrents(cleanQuery),
  ];

  const settled = await Promise.allSettled(mirrors);
  for (const res of settled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      items.push(...res.value);
    }
  }

  const uniqueMap = new Map();
  for (const item of items) {
    const existing = uniqueMap.get(item.infoHash);
    if (!existing || existing.seeds < item.seeds) {
      uniqueMap.set(item.infoHash, item);
    }
  }

  let finalItems = Array.from(uniqueMap.values());

  if (minSeeds > 0) {
    finalItems = finalItems.filter((i) => i.seeds >= minSeeds);
  }

  if (qualityFilter === '4k') {
    finalItems = finalItems.filter((i) => i.is4k);
  } else if (qualityFilter === '1080p') {
    finalItems = finalItems.filter((i) => i.is1080p);
  } else if (qualityFilter === '720p') {
    finalItems = finalItems.filter((i) => i.is720p);
  }

  if (sortBy === 'size') {
    finalItems.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  } else if (sortBy === 'title') {
    finalItems.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    finalItems.sort((a, b) => b.seeds - a.seeds);
  }

  return finalItems.slice(0, maxResults);
}

function formatStremioStreams(items) {
  return items.map((item) => {
    const seedBadge = item.seeds > 0 ? `🟢 ${item.seeds} seeds` : `⚪ 0 seeds`;
    const leechBadge = `🔴 ${item.leeches} leeches`;
    const qualityTag = item.quality || (item.is4k ? '4K' : item.is1080p ? '1080p' : item.is720p ? '720p' : 'HD');

    const nameLine = `[${qualityTag}] Knaben ⚡\n👥 ${item.seeds} seeds`;
    const titleLine = `${item.title}\n💾 ${item.size} | ${seedBadge} | ${leechBadge}\n⚡ Knaben Magnet Stream (Cloudflare)`;

    return {
      name: nameLine,
      title: titleLine,
      infoHash: item.infoHash,
      url: item.magnet,
      behaviorHints: {
        bingeGroup: `knaben-${qualityTag.toLowerCase()}`,
        notFast: false,
      },
    };
  });
}

function getLandingHtml(origin, manifestUrl, stremioDeepLink) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knaben Stremio Addon - Cloudflare Worker Edition</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #020617; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body class="min-h-screen flex flex-col justify-between selection:bg-purple-600 selection:text-white">
  <div class="max-w-4xl mx-auto px-4 py-12 w-full space-y-8">
    
    <div class="text-center space-y-3">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-semibold">
        <span>⚡ Cloudflare Workers Serverless</span>
        <span>•</span>
        <span class="text-emerald-400">24/7 Hoạt động</span>
      </div>
      <h1 class="text-3xl sm:text-4xl font-black tracking-tight text-white">
        Knaben Stremio Addon
      </h1>
      <p class="text-slate-400 text-sm max-w-xl mx-auto">
        Addon cào magnet link tự động từ Knaben.org, sắp xếp theo số lượng seeds cao nhất và hỗ trợ stream mượt mà trên Stremio.
      </p>
    </div>

    <!-- Quick Install Card -->
    <div class="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
      <div class="flex flex-col sm:flex-row gap-3">
        <a href="${stremioDeepLink}" class="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-600/30 transition-all active:scale-95">
          <span>🚀 Cài vào Stremio (1-Click)</span>
        </a>
        <a href="https://web.stremio.com/#/addon/detail?addon=${encodeURIComponent(manifestUrl)}" target="_blank" class="inline-flex items-center justify-center gap-2 px-5 py-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl font-semibold text-sm transition-all">
          <span>Mở Stremio Web</span>
        </a>
      </div>

      <div class="space-y-2">
        <label class="text-xs font-semibold text-slate-400">Link Manifest cài đặt thủ công (Dán vào ô tìm kiếm Addon trong Stremio):</label>
        <div class="flex gap-2">
          <input type="text" readonly value="${manifestUrl}" id="manifestInput" class="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-purple-300 select-all" />
          <button onclick="navigator.clipboard.writeText(document.getElementById('manifestInput').value); alert('Đã sao chép link manifest!')" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold cursor-pointer">
            Copy Link
          </button>
        </div>
      </div>
    </div>

    <!-- Endpoint Overview -->
    <div class="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 space-y-3 text-xs">
      <h3 class="font-bold text-slate-200 text-sm">📡 Các endpoint khả dụng:</h3>
      <ul class="space-y-1.5 font-mono text-slate-400">
        <li><strong class="text-purple-400">GET /manifest.json</strong> - Manifest chuẩn Stremio v4</li>
        <li><strong class="text-purple-400">GET /stream/:type/:id.json</strong> - Trả về streams torrent magnet cho phim/tập</li>
        <li><strong class="text-purple-400">GET /api/knaben/search?q=Inception</strong> - REST API tìm kiếm magnet trực tiếp</li>
        <li><strong class="text-purple-400">GET /api/health</strong> - Kiểm tra trạng thái máy chủ worker</li>
      </ul>
    </div>

  </div>

  <footer class="text-center py-6 text-xs text-slate-600 border-t border-slate-900">
    Knaben Stremio Addon • Hosted on Cloudflare Workers Global Edge Network
  </footer>
</body>
</html>`;
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const origin = url.origin;

    // Root landing page
    if (pathname === '/' || pathname === '') {
      const manifestUrl = `${origin}/manifest.json`;
      const stremioDeepLink = `stremio://${url.host}/manifest.json`;
      return new Response(getLandingHtml(origin, manifestUrl, stremioDeepLink), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS },
      });
    }

    // Health check
    if (pathname === '/api/health') {
      return jsonResponse({
        status: 'online',
        service: 'Knaben Stremio Addon (Cloudflare Worker)',
        version: '2.1.0',
        timestamp: new Date().toISOString(),
        region: request.cf?.colo || 'Global',
      });
    }

    // Manifest
    if (pathname === '/manifest.json') {
      const config = parseConfig(undefined, url.searchParams);
      return jsonResponse(getManifest(config));
    }

    const manifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json$/);
    if (manifestMatch) {
      const configStr = manifestMatch[1];
      const config = parseConfig(configStr, url.searchParams);
      return jsonResponse(getManifest(config));
    }

    // Streams
    const rootStreamMatch = pathname.match(/^\/stream\/([^/]+)\/([^/]+)\.json$/);
    const configStreamMatch = pathname.match(/^\/([^/]+)\/stream\/([^/]+)\/([^/]+)\.json$/);

    if (rootStreamMatch || configStreamMatch) {
      let configStr;
      let type;
      let id;

      if (configStreamMatch) {
        configStr = configStreamMatch[1];
        type = configStreamMatch[2];
        id = configStreamMatch[3];
      } else {
        type = rootStreamMatch[1];
        id = rootStreamMatch[2];
      }

      const config = parseConfig(configStr, url.searchParams);

      try {
        let searchQuery = '';
        if (id.startsWith('knaben:') || id.startsWith('kna:')) {
          searchQuery = decodeURIComponent(id.replace(/^(knaben:|kna:)/, ''));
        } else {
          searchQuery = decodeURIComponent(id);
        }

        if (!searchQuery.trim()) {
          return jsonResponse({ streams: [] });
        }

        const torrents = await scrapeKnaben(searchQuery, config);
        const streams = formatStremioStreams(torrents);

        return jsonResponse({ streams });
      } catch (err) {
        return jsonResponse({ streams: [] });
      }
    }

    // Search REST API
    if (pathname === '/api/knaben/search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) {
        return jsonResponse({ success: true, count: 0, items: [] });
      }

      const config = parseConfig(undefined, url.searchParams);
      try {
        const items = await scrapeKnaben(q, config);
        return jsonResponse({
          success: true,
          query: q,
          count: items.length,
          config,
          items,
        });
      } catch (err) {
        return jsonResponse(
          { success: false, error: err.message || 'Lỗi khi cào magnet từ Knaben' },
          500
        );
      }
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
