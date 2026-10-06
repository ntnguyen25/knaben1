import React, { useState, useEffect, useMemo } from 'react';
import JSZip from 'jszip';
import {
  Zap,
  Search,
  Download,
  Copy,
  ExternalLink,
  Check,
  Flame,
  Filter,
  ShieldCheck,
  Play,
  RefreshCw,
  Sliders,
  Globe,
  Info,
  Terminal,
  ArrowUpDown,
  HardDrive,
  Layers,
  Sparkles,
  Tag,
  AlertCircle,
  Clock,
  Link,
  Radio,
  FileDown,
  CheckCircle2,
  Share2,
  FolderArchive,
  ChevronDown,
  ChevronUp,
  Cloud,
  Code2
} from 'lucide-react';

interface TorrentItem {
  id: string;
  title: string;
  infoHash: string;
  magnet: string;
  seeds: number;
  leeches: number;
  size: string;
  sizeBytes?: number;
  category: string;
  date?: string;
  source: string;
  quality?: string;
  is4k?: boolean;
  is1080p?: boolean;
  is720p?: boolean;
  isHdr?: boolean;
  isRemux?: boolean;
}

export default function App() {
  // Scraper filters & config
  const [minSeeds, setMinSeeds] = useState<number>(0);
  const [qualityFilter, setQualityFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'seeds' | 'size' | 'title'>('seeds');
  const [maxResults, setMaxResults] = useState<number>(50);

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('Inception 2010');
  const [activeQuery, setActiveQuery] = useState<string>('Inception 2010');
  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<TorrentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchTime, setSearchTime] = useState<number>(0);

  // Copy feedback state
  const [copiedMagnet, setCopiedMagnet] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [copiedManifest, setCopiedManifest] = useState<boolean>(false);
  const [copiedZipUrl, setCopiedZipUrl] = useState<boolean>(false);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [copiedCfCode, setCopiedCfCode] = useState<boolean>(false);

  // Server health & PC connection
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [localPcStatus, setLocalPcStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');

  // Server mode: 'cloudflare' | 'cloud' | 'local_pc' | 'lan'
  const [serverMode, setServerMode] = useState<'cloudflare' | 'cloud' | 'local_pc' | 'lan'>('cloudflare');
  const [cfWorkerUrl, setCfWorkerUrl] = useState<string>('https://knaben-stremio.my-subdomain.workers.dev');
  const [lanIp, setLanIp] = useState<string>('192.168.1.100');
  const [pcPort, setPcPort] = useState<number>(3000);
  const [cfDeployTab, setCfDeployTab] = useState<'dashboard' | 'cli'>('dashboard');

  // Quick preset keywords for 1-click scraping
  const presets = [
    'Inception 2010',
    'Oppenheimer 2023',
    'Dune Part Two 2024',
    'Interstellar',
    'Game of Thrones S01E01',
    'Breaking Bad 1080p',
    'House of the Dragon',
    'Ubuntu 24.04'
  ];

  // Active base host
  const activeBaseUrl = useMemo(() => {
    if (serverMode === 'cloudflare') {
      return cfWorkerUrl.trim().replace(/\/+$/, '');
    }
    if (serverMode === 'local_pc') return `http://127.0.0.1:${pcPort}`;
    if (serverMode === 'lan') {
      const cleanIp = lanIp.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      return `http://${cleanIp}:${pcPort}`;
    }
    if (typeof window !== 'undefined') return window.location.origin;
    return 'http://localhost:3000';
  }, [serverMode, cfWorkerUrl, lanIp, pcPort]);

  // Manifest URL for Stremio
  const manifestUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (minSeeds > 0) params.set('minSeeds', minSeeds.toString());
    if (qualityFilter !== 'all') params.set('qualityFilter', qualityFilter);
    if (sortBy !== 'seeds') params.set('sortBy', sortBy);
    if (maxResults !== 50) params.set('maxResults', maxResults.toString());

    const paramString = params.toString();
    return paramString ? `${activeBaseUrl}/${paramString}/manifest.json` : `${activeBaseUrl}/manifest.json`;
  }, [activeBaseUrl, minSeeds, qualityFilter, sortBy, maxResults]);

  const stremioDeepLink = useMemo(() => manifestUrl.replace(/^https?:\/\//, 'stremio://'), [manifestUrl]);
  const stremioWebLink = useMemo(() => `https://web.stremio.com/#/addon/detail?addon=${encodeURIComponent(manifestUrl)}`, [manifestUrl]);

  // Direct ZIP download URL
  const directZipUrl = useMemo(() => {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/api/download-pc-zip`;
    }
    return '/api/download-pc-zip';
  }, []);

  // Check health on mount
  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(() => setServerStatus('online'))
      .catch(() => setServerStatus('offline'));
  }, []);

  // Test local PC connection if in PC mode
  const checkLocalPcConnection = async () => {
    setLocalPcStatus('checking');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`http://127.0.0.1:${pcPort}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      setLocalPcStatus(res.ok ? 'online' : 'offline');
    } catch {
      setLocalPcStatus('offline');
    }
  };

  useEffect(() => {
    if (serverMode === 'local_pc') checkLocalPcConnection();
  }, [serverMode, pcPort]);

  // ZIP download state
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);

  const downloadClientZip = async () => {
    setDownloadingZip(true);
    try {
      // Direct server-side download first
      const res = await fetch('/api/download-pc-zip');
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'knaben-magnet-scraper-pc.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      // Fallback to client-side JSZip packaging if direct endpoint fails
      const fallbackRes = await fetch('/api/source-files');
      const data = await fallbackRes.json();
      if (!data.success || !data.files) throw new Error('Không thể tải file mã nguồn.');

      const zip = new JSZip();
      for (const [filePath, content] of Object.entries(data.files)) {
        zip.file(filePath, content as string);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'knaben-magnet-scraper-pc.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Lỗi tạo ZIP: ' + ((e as Error).message || 'Vui lòng thử lại'));
    } finally {
      setDownloadingZip(false);
    }
  };

  // Perform direct Knaben Magnet search
  const performSearch = async (queryToSearch: string = searchQuery) => {
    const trimmed = queryToSearch.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setActiveQuery(trimmed);
    const startTime = performance.now();

    try {
      const params = new URLSearchParams({
        q: trimmed,
        minSeeds: minSeeds.toString(),
        qualityFilter,
        sortBy,
        maxResults: maxResults.toString()
      });

      const res = await fetch(`/api/knaben/search?${params.toString()}`);
      const data = await res.json();

      if (data.success) {
        setResults(data.items || []);
        setServerStatus('online');
      } else {
        setError(data.error || 'Lỗi khi cào magnet từ Knaben');
      }
    } catch {
      setError('Không thể kết nối tới Knaben Scraper server.');
    } finally {
      setSearchTime(Math.round(performance.now() - startTime));
      setLoading(false);
    }
  };

  // Auto-run initial search
  useEffect(() => {
    performSearch('Inception 2010');
  }, []);

  // Copy magnet link helper
  const handleCopyMagnet = (magnet: string, id: string) => {
    navigator.clipboard.writeText(magnet);
    setCopiedMagnet(id);
    setTimeout(() => setCopiedMagnet(null), 2500);
  };

  // Copy hash helper
  const handleCopyHash = (hash: string, id: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(id);
    setTimeout(() => setCopiedHash(null), 2500);
  };

  // Copy all magnets
  const handleCopyAllMagnets = () => {
    if (results.length === 0) return;
    const allMagnets = results.map(r => r.magnet).join('\n\n');
    navigator.clipboard.writeText(allMagnets);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2500);
  };

  // Copy manifest URL
  const handleCopyManifest = () => {
    navigator.clipboard.writeText(manifestUrl);
    setCopiedManifest(true);
    setTimeout(() => setCopiedManifest(false), 2500);
  };

  // Copy Cloudflare Worker Code
  const handleCopyCfCode = async () => {
    try {
      const res = await fetch('/api/cloudflare-code');
      const data = await res.json();
      if (data.success && data.code) {
        navigator.clipboard.writeText(data.code);
        setCopiedCfCode(true);
        setTimeout(() => setCopiedCfCode(false), 2500);
      }
    } catch {
      alert('Không thể tải mã nguồn Cloudflare Worker.');
    }
  };

  // Copy direct zip URL
  const handleCopyZipUrl = () => {
    navigator.clipboard.writeText(directZipUrl);
    setCopiedZipUrl(true);
    setTimeout(() => setCopiedZipUrl(false), 2500);
  };

  // Download magnets list as .txt
  const handleExportTxt = () => {
    if (results.length === 0) return;
    const textContent = results.map((r, idx) => 
      `#${idx + 1} [${r.quality || 'HD'}] ${r.title}\nSeeds: ${r.seeds} | Leeches: ${r.leeches} | Size: ${r.size}\nHash: ${r.infoHash}\nMagnet: ${r.magnet}\n`
    ).join('\n---\n\n');

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `knaben-magnets-${activeQuery.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const [showGuide, setShowGuide] = useState<boolean>(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-purple-600 selection:text-white">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-purple-500/20 text-white font-bold text-xl">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-purple-400 via-indigo-300 to-cyan-400 bg-clip-text text-transparent">
                  Knaben Magnet Scraper
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  v2.0 Pure Scraper
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Cào trực tiếp link Magnet & Torrent từ Knaben.org (Không metadata trung gian)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Direct Download PC Code Button */}
            <button
              onClick={downloadClientZip}
              disabled={downloadingZip}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/80 hover:bg-cyan-900/90 text-cyan-300 border border-cyan-700/60 text-xs font-semibold transition-all active:scale-95 shadow-sm"
              title="Tải trọn bộ mã nguồn chạy Local PC (.ZIP)"
            >
              {downloadingZip ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Tải ZIP PC</span>
            </button>

            {/* Server Status Pill */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300">
              <span className={`w-2 h-2 rounded-full ${serverStatus === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
              <span className="hidden sm:inline">Trạng thái:</span>
              <span className="font-medium text-slate-200">
                {serverStatus === 'online' ? 'Online' : 'Checking'}
              </span>
            </div>

            {/* Stremio Install Button */}
            <a
              href={stremioDeepLink}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/30 transition-all active:scale-95"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Cài vào Stremio</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Banner: Tải mã nguồn chạy PC Localhost */}
        <div className="rounded-2xl bg-gradient-to-r from-cyan-950/60 via-slate-900 to-indigo-950/60 border border-cyan-800/50 p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <FolderArchive className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base text-white">Tải Trọn Bộ Mã Nguồn Chạy PC Localhost (.ZIP)</h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  start-local-pc.bat / .sh
                </span>
              </div>
              <p className="text-xs text-slate-300/90 mt-0.5">
                Chạy trực tiếp trên máy tính tại <strong className="text-cyan-300 font-mono">http://127.0.0.1:3000</strong> mà không sợ giới hạn IP hay nghẽn mạng.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Download Button */}
            <button
              type="button"
              onClick={downloadClientZip}
              disabled={downloadingZip}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-600/25 transition-all active:scale-95"
            >
              {downloadingZip ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Đang tải file ZIP...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Tải file ZIP (.zip)</span>
                </>
              )}
            </button>

            {/* Copy Download Link */}
            <button
              type="button"
              onClick={handleCopyZipUrl}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-all"
              title="Sao chép link tải trực tiếp"
            >
              {copiedZipUrl ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedZipUrl ? 'Đã sao chép link' : 'Copy link tải'}</span>
            </button>

            {/* Toggle Guide */}
            <button
              type="button"
              onClick={() => setShowGuide(!showGuide)}
              className="inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
            >
              <span>Hướng dẫn</span>
              {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Collapsible Guide for PC Localhost */}
        {showGuide && (
          <div className="rounded-2xl bg-slate-900 border border-cyan-800/40 p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <h3 className="font-bold text-sm text-cyan-300 flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              Các bước chạy máy chủ Addon trên PC cá nhân (3 bước đơn giản):
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-200">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs">1</span>
                  <span>Giải nén file ZIP</span>
                </div>
                <p className="text-slate-400">
                  Tải file <strong className="text-slate-200 font-mono">knaben-magnet-scraper-pc.zip</strong> về và giải nén ra một thư mục bất kỳ trên máy tính.
                </p>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-200">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs">2</span>
                  <span>Khởi chạy tự động</span>
                </div>
                <p className="text-slate-400">
                  - <strong>Windows:</strong> Nhấp đôi file <span className="font-mono text-cyan-300">start-local-pc.bat</span>.<br />
                  - <strong>Mac/Linux:</strong> Mở Terminal chạy <span className="font-mono text-cyan-300">./start-local-pc.sh</span>.
                </p>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-200">
                  <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs">3</span>
                  <span>Cài Addon vào Stremio</span>
                </div>
                <p className="text-slate-400">
                  Mở ứng dụng <strong>Stremio</strong> &rarr; Vào mục <strong>Add-ons</strong> &rarr; Dán link:
                  <code className="block mt-1 p-1 bg-slate-900 text-purple-300 rounded font-mono select-all">http://127.0.0.1:3000/manifest.json</code>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Search Hero Section */}
        <div className="relative rounded-2xl bg-gradient-to-b from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 p-6 sm:p-8 shadow-2xl overflow-hidden">
          {/* Subtle glow backdrop */}
          <div className="absolute top-0 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none"></div>

          <div className="relative z-10 space-y-6">
            <div className="max-w-3xl">
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-3">
                <span>Tìm & Cào Magnet Link từ Knaben</span>
                <span className="text-xs px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  ⚡ Auto Seeds Sorting
                </span>
              </h1>
              <p className="text-slate-400 text-sm mt-2">
                Nhập tên phim, tập phim (S01E01), phần mềm, game hoặc từ khóa bất kỳ. Hệ thống sẽ cào danh sách magnet tức thì từ Knaben và sắp xếp seeder từ cao xuống thấp.
              </p>
            </div>

            {/* Main Search Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                performSearch(searchQuery);
              }}
              className="flex flex-col sm:flex-row gap-3"
            >
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Nhập tên phim, phim bộ, game hoặc từ khóa... (VD: Inception 2010, Oppenheimer, Ubuntu)"
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all text-sm sm:text-base font-medium"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300 px-2 py-1"
                  >
                    Xóa
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-purple-600/25 transition-all active:scale-95 cursor-pointer whitespace-nowrap text-sm sm:text-base"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    <span>Đang cào dữ liệu...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5 fill-current" />
                    <span>Cào Magnet Knaben</span>
                  </>
                )}
              </button>
            </form>

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-slate-500 font-medium flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                Gợi ý nhanh:
              </span>
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setSearchQuery(preset);
                    performSearch(preset);
                  }}
                  className="text-xs px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border border-slate-700/50 transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Filters Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-800/80">
              {/* Quality Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-purple-400" />
                  Độ phân giải (Quality)
                </label>
                <select
                  value={qualityFilter}
                  onChange={(e) => {
                    setQualityFilter(e.target.value);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500"
                >
                  <option value="all">Tất cả chất lượng (All)</option>
                  <option value="4k">Chỉ 4K UHD (2160p)</option>
                  <option value="1080p">Chỉ 1080p Full HD</option>
                  <option value="720p">Chỉ 720p HD</option>
                </select>
              </div>

              {/* Min Seeds Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-emerald-400" />
                  Số Seeds tối thiểu
                </label>
                <select
                  value={minSeeds}
                  onChange={(e) => {
                    setMinSeeds(parseInt(e.target.value, 10));
                  }}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500"
                >
                  <option value="0">Tất cả (Kể cả 0 seed)</option>
                  <option value="5">Tối thiểu 5 seeds</option>
                  <option value="10">Tối thiểu 10 seeds</option>
                  <option value="20">Tối thiểu 20 seeds (Nhanh)</option>
                  <option value="50">Tối thiểu 50 seeds (Siêu nhanh)</option>
                </select>
              </div>

              {/* Sort Order */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <ArrowUpDown className="w-3.5 h-3.5 text-cyan-400" />
                  Sắp xếp kết quả
                </label>
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as any);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500"
                >
                  <option value="seeds">Seeds cao nhất trước (Khuyên dùng)</option>
                  <option value="size">Dung lượng file lớn nhất</option>
                  <option value="title">Tên tệp (A-Z)</option>
                </select>
              </div>

              {/* Max Results */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  Số lượng kết quả tối đa
                </label>
                <select
                  value={maxResults}
                  onChange={(e) => {
                    setMaxResults(parseInt(e.target.value, 10));
                  }}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-purple-500"
                >
                  <option value="25">25 magnets</option>
                  <option value="50">50 magnets (Chuẩn)</option>
                  <option value="100">100 magnets</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Results Section */}
        <div className="space-y-4">
          {/* Header Summary & Bulk Actions */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800/80 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <Zap className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Kết quả cào Magnet:</span>
                  <span className="text-purple-300 font-mono">"{activeQuery}"</span>
                </h2>
                <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                  <span>Tìm thấy <strong className="text-emerald-400 font-mono">{results.length}</strong> magnet</span>
                  <span>•</span>
                  <span>Thời gian cào: <strong className="text-slate-200 font-mono">{searchTime}ms</strong></span>
                  <span>•</span>
                  <span className="text-slate-400">Nguồn: Knaben.org</span>
                </div>
              </div>
            </div>

            {/* Action Buttons: Copy all, Export txt, Refresh */}
            {results.length > 0 && (
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleCopyAllMagnets}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold transition-all active:scale-95"
                  title="Sao chép toàn bộ magnet link vào Clipboard"
                >
                  {copiedAll ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                  <span>{copiedAll ? 'Đã sao chép tất cả!' : 'Sao chép tất cả'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportTxt}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold transition-all active:scale-95"
                  title="Xuất file danh sách magnet .txt"
                >
                  <FileDown className="w-4 h-4 text-cyan-400" />
                  <span>Xuất .txt</span>
                </button>

                <button
                  type="button"
                  onClick={() => performSearch(activeQuery)}
                  disabled={loading}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all"
                  title="Cào lại"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            )}
          </div>

          {/* Loading Skeleton */}
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((idx) => (
                <div key={idx} className="animate-pulse bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                  <div className="h-5 bg-slate-800 rounded w-3/4"></div>
                  <div className="flex gap-4">
                    <div className="h-4 bg-slate-800 rounded w-24"></div>
                    <div className="h-4 bg-slate-800 rounded w-20"></div>
                    <div className="h-4 bg-slate-800 rounded w-32"></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error Banner */}
          {error && !loading && (
            <div className="p-6 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 flex items-start gap-4">
              <AlertCircle className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-rose-100">Không thể cào dữ liệu từ Knaben</h3>
                <p className="text-sm text-rose-300/90 mt-1">{error}</p>
                <button
                  onClick={() => performSearch(activeQuery)}
                  className="mt-3 px-4 py-1.5 rounded-lg bg-rose-800/60 hover:bg-rose-700/80 text-white text-xs font-semibold"
                >
                  Thử lại ngay
                </button>
              </div>
            </div>
          )}

          {/* Empty Results */}
          {!loading && !error && results.length === 0 && (
            <div className="text-center py-16 px-4 bg-slate-900/40 rounded-2xl border border-slate-800/60 space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                <Search className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-bold text-slate-200">Không tìm thấy torrent/magnet nào</h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                Không tìm thấy kết quả phù hợp cho từ khóa <strong className="text-slate-200 font-mono">"{activeQuery}"</strong> với bộ lọc hiện tại. Thử giảm số seeds tối thiểu hoặc chọn từ khóa khác.
              </p>
              <div className="pt-2">
                <button
                  onClick={() => {
                    setMinSeeds(0);
                    setQualityFilter('all');
                    performSearch(activeQuery);
                  }}
                  className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-md shadow-purple-600/30"
                >
                  Đặt lại bộ lọc & Tìm lại
                </button>
              </div>
            </div>
          )}

          {/* Torrents List */}
          {!loading && results.length > 0 && (
            <div className="space-y-3">
              {results.map((torrent, index) => {
                const isTopSeed = index === 0 && torrent.seeds > 0;
                const isCopied = copiedMagnet === torrent.id;
                const isHashCopied = copiedHash === torrent.id;

                return (
                  <div
                    key={torrent.id}
                    className={`group relative rounded-xl border transition-all duration-200 p-4 sm:p-5 ${
                      isTopSeed
                        ? 'bg-slate-900/90 border-purple-500/40 shadow-lg shadow-purple-500/5 hover:border-purple-500/70'
                        : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900/80 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      
                      {/* Left: Torrent Info */}
                      <div className="space-y-2.5 flex-1 min-w-0">
                        {/* Title & Quality Badges */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                            isTopSeed ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'
                          }`}>
                            #{index + 1}
                          </span>

                          {torrent.is4k && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              4K UHD
                            </span>
                          )}
                          {torrent.is1080p && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
                              1080p FHD
                            </span>
                          )}
                          {torrent.is720p && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                              720p HD
                            </span>
                          )}
                          {torrent.isHdr && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                              HDR / DV
                            </span>
                          )}
                          {torrent.isRemux && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                              REMUX
                            </span>
                          )}

                          <span className="text-xs text-slate-500 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/40">
                            {torrent.source}
                          </span>

                          {isTopSeed && (
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                              <Flame className="w-3 h-3 text-purple-400 fill-current" />
                              Top 1 Seeds
                            </span>
                          )}
                        </div>

                        {/* Full Torrent Title */}
                        <h3 className="text-sm sm:text-base font-semibold text-slate-100 group-hover:text-purple-300 transition-colors break-words leading-snug">
                          {torrent.title}
                        </h3>

                        {/* Specs row: Seeds, Leeches, Size, Hash */}
                        <div className="flex flex-wrap items-center gap-y-2 gap-x-4 text-xs text-slate-400">
                          {/* Seeds */}
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 font-semibold font-mono">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            <span>{torrent.seeds.toLocaleString()} seeds</span>
                          </div>

                          {/* Leeches */}
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-950/30 border border-rose-800/30 text-rose-400 font-mono">
                            <span>{torrent.leeches.toLocaleString()} leeches</span>
                          </div>

                          {/* Size */}
                          <div className="flex items-center gap-1 text-slate-300 font-medium">
                            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                            <span>{torrent.size}</span>
                          </div>

                          {/* Date if exists */}
                          {torrent.date && (
                            <div className="flex items-center gap-1 text-slate-400">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{torrent.date}</span>
                            </div>
                          )}

                          {/* InfoHash with click to copy */}
                          <button
                            type="button"
                            onClick={() => handleCopyHash(torrent.infoHash, torrent.id)}
                            className="flex items-center gap-1 font-mono text-slate-400 hover:text-slate-200 transition-colors"
                            title="Sao chép InfoHash"
                          >
                            <Tag className="w-3.5 h-3.5 text-slate-500" />
                            <span>{torrent.infoHash.slice(0, 10)}...</span>
                            {isHashCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                          </button>
                        </div>
                      </div>

                      {/* Right: Quick Actions */}
                      <div className="flex sm:flex-row lg:flex-col items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800">
                        {/* 1-Click Copy Magnet */}
                        <button
                          type="button"
                          onClick={() => handleCopyMagnet(torrent.magnet, torrent.id)}
                          className={`w-full sm:w-auto lg:w-36 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all active:scale-95 ${
                            isCopied
                              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                              : 'bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/20'
                          }`}
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-4 h-4" />
                              <span>Đã sao chép!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span>Copy Magnet</span>
                            </>
                          )}
                        </button>

                        {/* Open in Torrent Client */}
                        <a
                          href={torrent.magnet}
                          className="w-full sm:w-auto lg:w-36 flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold transition-all active:scale-95"
                          title="Mở trực tiếp trong uTorrent, qBittorrent hoặc Stremio"
                        >
                          <ExternalLink className="w-4 h-4 text-cyan-400" />
                          <span>Mở Torrent Client</span>
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Stremio Addon Integration & Deployment Options */}
        <div className="space-y-6 pt-4">
          
          {/* Cloudflare Workers Banner / Highlight Card */}
          <div className="rounded-2xl bg-gradient-to-r from-orange-950/70 via-slate-900 to-amber-950/60 border border-orange-700/50 p-6 shadow-2xl space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-400 shrink-0 shadow-lg shadow-orange-500/20">
                  <Cloud className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-white">Triển khai lên Cloudflare Workers (Khuyên dùng cho Stremio)</h2>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30">
                      ⚡ 24/7 Online • Miễn phí 100,000 req/ngày
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 max-w-2xl">
                    Chạy Addon trên mạng lưới phân tán toàn cầu của Cloudflare, độ trễ cực thấp, không cần mở máy tính hay duy trì máy chủ.
                  </p>
                </div>
              </div>

              {/* Copy Standalone Worker Script Button */}
              <button
                type="button"
                onClick={handleCopyCfCode}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-lg shadow-orange-600/30 transition-all active:scale-95 shrink-0 cursor-pointer"
              >
                {copiedCfCode ? <Check className="w-4 h-4 text-white" /> : <Code2 className="w-4 h-4" />}
                <span>{copiedCfCode ? 'Đã sao chép mã Worker!' : 'Sao chép mã Worker (1-File)'}</span>
              </button>
            </div>

            {/* Cloudflare Deployment Guide Tabs */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <button
                  type="button"
                  onClick={() => setCfDeployTab('dashboard')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    cfDeployTab === 'dashboard'
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Cách 1: Triển khai qua Web Dashboard (Không cần cài phần mềm)
                </button>
                <button
                  type="button"
                  onClick={() => setCfDeployTab('cli')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    cfDeployTab === 'cli'
                      ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Cách 2: Triển khai bằng Wrangler CLI
                </button>
              </div>

              {cfDeployTab === 'dashboard' ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-slate-200">
                      <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs">1</span>
                      <span>Tạo Worker trên Cloudflare</span>
                    </div>
                    <p className="text-slate-400">
                      Truy cập <a href="https://dash.cloudflare.com" target="_blank" rel="noreferrer" className="text-orange-400 underline font-medium">dash.cloudflare.com</a> &rarr; <strong>Workers & Pages</strong> &rarr; <strong>Create application</strong> &rarr; <strong>Create Worker</strong> &rarr; Đặt tên &rarr; <strong>Deploy</strong>.
                    </p>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-slate-200">
                      <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs">2</span>
                      <span>Dán mã nguồn Worker</span>
                    </div>
                    <p className="text-slate-400">
                      Nhấn <strong>Edit Code</strong> &rarr; Xóa code mặc định và dán toàn bộ file <strong className="text-orange-300 font-mono">cloudflare-worker.js</strong> (sử dụng nút sao chép ở trên) &rarr; Nhấn <strong>Save and deploy</strong>.
                    </p>
                  </div>

                  <div className="bg-slate-900 border border-slate-800/80 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-slate-200">
                      <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs">3</span>
                      <span>Nhận Link Stremio Addon</span>
                    </div>
                    <p className="text-slate-400">
                      Dán domain Worker của bạn vào ô bên dưới để tạo link cài đặt Stremio tự động (hoặc thêm <code className="text-purple-300 font-mono">/manifest.json</code> vào đuôi domain).
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 text-xs text-slate-300 font-mono bg-slate-900 border border-slate-800 p-4 rounded-xl">
                  <p className="text-slate-400 font-sans">Triển khai trực tiếp từ terminal trong 1 lệnh:</p>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-orange-300 select-all space-y-1">
                    <p># Triển khai tự động bằng Wrangler</p>
                    <p className="font-bold">npx wrangler deploy</p>
                    <p className="text-slate-500"># Hoặc chạy file ./deploy-cloudflare.sh (Mac/Linux) hoặc deploy-cloudflare.bat (Windows)</p>
                  </div>
                </div>
              )}

              {/* Cloudflare Worker Domain Configurator */}
              <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <label className="text-xs font-semibold text-slate-300 shrink-0">
                  Domain Cloudflare Worker của bạn:
                </label>
                <div className="flex-1 w-full flex items-center gap-2">
                  <input
                    type="text"
                    value={cfWorkerUrl}
                    onChange={(e) => {
                      setCfWorkerUrl(e.target.value);
                      if (serverMode !== 'cloudflare') setServerMode('cloudflare');
                    }}
                    placeholder="https://knaben-stremio.ten-ban.workers.dev"
                    className="flex-1 bg-slate-950 border border-slate-700 text-slate-100 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => setServerMode('cloudflare')}
                    className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                      serverMode === 'cloudflare'
                        ? 'bg-orange-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {serverMode === 'cloudflare' ? 'Đang chọn' : 'Sử dụng link này'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Stremio Setup Card */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <Play className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Cài đặt vào Stremio (Manifest v4)</h3>
                  <p className="text-xs text-slate-400">Link Addon theo cấu hình máy chủ hiện tại: <strong className="text-purple-300 font-mono">{serverMode.toUpperCase()}</strong></p>
                </div>
              </div>

              {/* Mode Selector */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setServerMode('cloudflare')}
                  className={`py-2 px-2 text-center rounded-lg text-xs font-semibold border transition-all ${
                    serverMode === 'cloudflare'
                      ? 'bg-orange-500/20 border-orange-500 text-orange-300 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  Cloudflare (24/7)
                </button>
                <button
                  type="button"
                  onClick={() => setServerMode('cloud')}
                  className={`py-2 px-2 text-center rounded-lg text-xs font-semibold border transition-all ${
                    serverMode === 'cloud'
                      ? 'bg-purple-600/20 border-purple-500 text-purple-300 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  Cloud AIS
                </button>
                <button
                  type="button"
                  onClick={() => setServerMode('local_pc')}
                  className={`py-2 px-2 text-center rounded-lg text-xs font-semibold border transition-all ${
                    serverMode === 'local_pc'
                      ? 'bg-cyan-600/20 border-cyan-500 text-cyan-300 shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  PC (127.0.0.1)
                </button>
              </div>

              {/* Manifest Box */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400">Đường dẫn Stremio Manifest URL:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={manifestUrl}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-purple-300 select-all"
                  />
                  <button
                    type="button"
                    onClick={handleCopyManifest}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {copiedManifest ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedManifest ? 'Đã chép' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={stremioDeepLink}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-md shadow-purple-600/30 transition-all active:scale-95"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>1-Click Cài vào App Stremio</span>
                </a>
                <a
                  href={stremioWebLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Mở trên Stremio Web</span>
                </a>
              </div>
            </div>

            {/* PC Localhost Package Card */}
            <div className="rounded-2xl bg-slate-900/80 border border-slate-800 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Chạy Server Riêng trên Máy Tính (Local PC)</h3>
                  <p className="text-xs text-slate-400">Không lo bị chặn IP, tốc độ cào tối đa và kết nối mạng nội bộ LAN</p>
                </div>
              </div>

              {/* Direct Link box */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400">Link tải trực tiếp file mã nguồn ZIP:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={directZipUrl}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 select-all"
                  />
                  <button
                    type="button"
                    onClick={handleCopyZipUrl}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    {copiedZipUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedZipUrl ? 'Đã chép' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={downloadClientZip}
                disabled={downloadingZip}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-cyan-600/30 transition-all active:scale-95 cursor-pointer"
              >
                {downloadingZip ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Đang đóng gói ZIP...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Tải trọn bộ mã nguồn PC & Cloudflare (.ZIP)</span>
                  </>
                )}
              </button>
            </div>

          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/40 py-6 mt-12 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-400" />
            <span className="text-slate-400 font-medium">Knaben Magnet Scraper & Stremio Addon</span>
          </div>
          <p>
            Dữ liệu được cào trực tiếp từ Knaben.org. Trực tiếp xuất link Magnet chuẩn P2P.
          </p>
        </div>
      </footer>
    </div>
  );
}
