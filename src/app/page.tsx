"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Clock,
  Star,
  Settings,
  Zap,
  Search,
  Plus,
  X,
  ChevronDown,
  ExternalLink,
  AlertTriangle,
  Cpu,
  Loader2,
  DollarSign
} from "lucide-react";

// Interfaces
interface Job {
  id: string;
  title: string;
  company: string;
  source: "remotive" | "remoteok" | "jooble" | "muse" | "wwr" | "arbeitnow" | "getonbrd" | "remotojob" | "findjobit";
  sourceLabel: string;
  date: string;
  url: string;
  description: string;
  tags: string[];
  location: string;
  salary: string | null;
  remote: boolean;
  crRelevance: "high" | "medium" | "low";
  category: string;
  jobType: string;
  language: "es" | "en";
}

interface FetchStatus {
  status: "loading" | "loaded" | "failed" | "not_configured";
  msg: string;
}

interface AIScore {
  score: number;
  reason: string;
}

interface AppSettings {
  joobleKey: string;
  groqKey: string;
  anthropicKey: string;
  aiProvider: "groq" | "anthropic";
}

// --- NORMALIZATION HELPERS (Client-Side) ---
function truncateString(str: string, num: number): string {
  if (!str) return "";
  if (str.length <= num) return str;
  return str.slice(0, num) + "...";
}

function computeRelevance(job: Partial<Job>): "high" | "medium" | "low" {
  const desc = (job.description || "").toLowerCase();
  const title = (job.title || "").toLowerCase();
  const loc = (job.location || "").toLowerCase();
  const tags = (job.tags || []).map(t => t.toLowerCase());

  // Check for explicit Costa Rica / CR match (highest priority)
  const isCrMatch = ["costa rica", "centroamerica", "centroamérica"].some(k => desc.includes(k) || title.includes(k) || loc.includes(k) || tags.includes(k)) ||
                    (/\bcr\b/.test(desc) || /\bcr\b/.test(title) || /\bcr\b/.test(loc) || tags.includes("cr"));

  // Check for Latin American regional sources or matches
  const isLatamSource = ["getonbrd", "remotojob", "findjobit"].includes(job.source || "");
  const latamKeywords = [
    "latam", "latin america", "latinoamerica", "latinoamérica", "español", "spanish", 
    "colombia", "mexico", "méxico", "argentina", "chile", "peru", "perú", "ecuador", 
    "venezuela", "uruguay", "panama", "panamá", "honduras", "guatemala", "el salvador", 
    "nicaragua", "bolivia", "paraguay", "dominican republic", "república dominicana"
  ];
  const isLatamMatch = latamKeywords.some(k => desc.includes(k) || title.includes(k) || loc.includes(k) || tags.includes(k));

  // Salary USD under $5k/month
  let isLowSalaryUSD = false;
  if (job.salary) {
    const salStr = job.salary.toLowerCase();
    if (salStr.includes("$") || salStr.includes("usd")) {
      const numbers = salStr.match(/\d+[\d,.]*/g);
      if (numbers) {
        const parsedNums = numbers.map(n => {
          let clean = n.replace(/[,.]/g, "");
          return parseInt(clean, 10);
        }).filter(n => !isNaN(n));
        
        // monthly: 1000 - 5000, annual: 12000 - 60000, hourly: 10 - 30
        const isMonthlyUnder5k = parsedNums.some(num => (num >= 1000 && num <= 5000) || (num >= 12000 && num <= 60000) || (num > 10 && num < 30));
        if (isMonthlyUnder5k) {
          isLowSalaryUSD = true;
        }
      }
    }
  }

  // Check if timezone/country restricts explicitly to incompatible regions
  const hasIncompatibleBlock = loc.includes("us only") || loc.includes("eu only") || loc.includes("usa only") || 
                                loc.includes("europe") || loc.includes("united states") || loc.includes("canada") || 
                                loc.includes("uk only") || loc.includes("germany") || loc.includes("timezone: est") || 
                                loc.includes("timezone: pst");

  if (hasIncompatibleBlock) {
    return "low";
  }

  if (isCrMatch || isLatamSource || isLatamMatch || isLowSalaryUSD) {
    return "high";
  }

  const locClean = loc.trim();
  const isWorldwide = locClean === "" || locClean === "worldwide" || locClean.includes("anywhere") || locClean.includes("worldwide") || locClean.includes("remote - worldwide");
  if (isWorldwide || job.remote) {
    return "medium";
  }

  return "low";
}

function categorizeJob(job: Partial<Job>): string {
  const text = `${job.title} ${(job.tags || []).join(' ')}`.toLowerCase();
  
  if (/\b(dev|developer|engineer|software|code|tech|qa|testing|frontend|backend|fullstack|system|security|programador|web|it)\b/.test(text)) {
    return "Tecnología";
  }
  if (/\b(marketing|seo|growth|social|media|copywriter|content|advertising|publicidad)\b/.test(text)) {
    return "Marketing";
  }
  if (/\b(design|designer|ux|ui|graphic|diseñador|illustration|product)\b/.test(text)) {
    return "Diseño";
  }
  if (/\b(support|soporte|customer|helpdesk|client|success|atención|service)\b/.test(text)) {
    return "Soporte";
  }
  if (/\b(sales|ventas|business development|account executive|sdr|bdr|cold|vendedor)\b/.test(text)) {
    return "Ventas";
  }
  if (/\b(finance|finanzas|accounting|contable|cfo|tax|auditor|financial)\b/.test(text)) {
    return "Finanzas";
  }
  if (/\b(data|datos|analytics|analyst|bi|machine learning|ai|database|science)\b/.test(text)) {
    return "Datos";
  }
  return "Otro";
}

function classifyJobType(job: Partial<Job>): string {
  const text = `${job.title} ${(job.tags || []).join(' ')} ${job.jobType || ''}`.toLowerCase();
  if (text.includes("part-time") || text.includes("parttime") || text.includes("medio tiempo") || text.includes("p/t")) {
    return "Part-time";
  }
  if (text.includes("contract") || text.includes("contrato") || text.includes("temporary") || text.includes("temporada")) {
    return "Contrato";
  }
  if (text.includes("freelance") || text.includes("freelancer") || text.includes("autónomo") || text.includes("autonomo")) {
    return "Freelance";
  }
  return "Full-time";
}

function detectLanguage(job: Partial<Job>): "es" | "en" {
  const text = ` ${job.title} ${job.description} `.toLowerCase();
  
  // Portuguese markers (exclusively Portuguese or extremely common in PT and rare/absent in ES)
  const portugueseMarkers = [
    " desenvolvimento ", " equipe ", " você ", " não ", " com ", " em ", 
    " um ", " uma ", " da ", " do ", " dos ", " das ", " seu ", " sua ",
    " vaga ", " vagas ", " inscrição ", " inscrições ", " conosco ", " português ", " portugues "
  ];
  
  let portugueseCount = 0;
  portugueseMarkers.forEach(word => {
    if (text.includes(word)) {
      portugueseCount++;
    }
  });

  // If it has strong Portuguese markers, it is not Spanish
  if (portugueseCount >= 2 || text.includes(" desenvolvimento ") || text.includes(" equipe ") || text.includes(" você ") || text.includes(" português ")) {
    return "en";
  }

  const spanishStopWords = [
    " de ", " que ", " en ", " el ", " la ", " los ", " las ", " un ", " una ", 
    " para ", " con ", " por ", " como ", " más ", " su ", " sus ", " al ", " del ",
    " requiere ", " experiencia ", " requisitos ", " conocimiento ", " habilidades ",
    " trabajo ", " empleo ", " remoto ", " empresa ", " equipo ", " desarrollo "
  ];
  
  let spanishCount = 0;
  spanishStopWords.forEach(word => {
    if (text.includes(word)) {
      spanishCount++;
    }
  });

  if (spanishCount >= 3) {
    return "es";
  }
  
  const spanishTitleTerms = [
    /\b(programador|desarrollador|diseñador|soporte|asistente|vendedor|contador|administrador|encargado|gerente|analista|practicante|recepcionista|chofer|conductor|bodeguero|cajero|ejecutivo)\b/
  ];
  if (spanishTitleTerms.some(regex => regex.test(job.title?.toLowerCase() || ""))) {
    return "es";
  }

  return "en";
}

// Helper to fetch text from a target URL via resilient CORS proxies
async function fetchViaCorsProxy(targetUrl: string, timeoutMs = 6000): Promise<Response> {
  // 1. Try local server-side proxy (most reliable and avoids CORS)
  try {
    const res = await fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.ok) return res;
  } catch (e) {
    console.warn("Local proxy failed, trying allorigins.win...", e);
  }

  // 2. Fallback to allorigins.win
  try {
    const res = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (res.ok) return res;
  } catch (e) {
    console.warn("allorigins.win failed, trying corsproxy.io...", e);
  }

  // 3. Fallback to corsproxy.io
  const res = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`, {
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`CORS proxies failed for ${targetUrl}`);
  return res;
}

// Helper to fetch RSS and parse it using DOMParser with CORS proxy, or fallback to rss2json
async function fetchAndParseRSS(feedUrl: string): Promise<any[]> {
  try {
    // 1. Try to fetch raw XML via a CORS proxy helper
    const res = await fetchViaCorsProxy(feedUrl);
    if (!res.ok) throw new Error("CORS proxy response was not OK");
    const xmlText = await res.text();
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
    
    // Check for parse errors
    if (doc.querySelector("parsererror")) {
      throw new Error("XML parser error");
    }
    
    const items = doc.querySelectorAll("item");
    const parsedItems: any[] = [];
    
    items.forEach(item => {
      const title = item.querySelector("title")?.textContent || "";
      const link = item.querySelector("link")?.textContent || "";
      
      // Handle namespaces (like dc:creator, content:encoded) cross-browser by looking at localName
      const authorNode = Array.from(item.childNodes).find((node: any) => 
        node.localName === "creator" || node.localName === "author"
      ) as ChildNode | undefined;
      const author = authorNode?.textContent || "";
      
      const pubDateNode = Array.from(item.childNodes).find((node: any) => 
        node.localName === "pubDate" || node.localName === "date"
      ) as ChildNode | undefined;
      const pubDate = pubDateNode?.textContent || "";
      
      const descNode = Array.from(item.childNodes).find((node: any) => 
        node.localName === "description" || node.localName === "encoded"
      ) as ChildNode | undefined;
      const description = descNode?.textContent || "";
      
      const categories: string[] = [];
      Array.from(item.childNodes).forEach((node: any) => {
        if (node.localName === "category" && node.textContent) {
          categories.push(node.textContent.trim());
        }
      });
      
      parsedItems.push({
        title,
        link,
        pubDate,
        author,
        description,
        categories
      });
    });
    
    if (parsedItems.length > 0) {
      return parsedItems;
    }
  } catch (e) {
    console.warn(`Direct XML RSS fetch/parse failed for ${feedUrl}, falling back to rss2json:`, e);
  }

  // 2. Fallback to rss2json.com
  const rss2jsonUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
  const res = await fetch(rss2jsonUrl, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error("Ambos métodos de obtención de RSS fallaron");
  const data = await res.json();
  if (!data || !Array.isArray(data.items)) {
    throw new Error("Formato de rss2json inválido");
  }
  
  return data.items.map((item: any) => ({
    title: item.title || "",
    link: item.link || item.guid || "",
    pubDate: item.pubDate || "",
    author: item.author || item.dc_creator || "",
    description: item.description || item.content || "",
    categories: Array.isArray(item.categories) ? item.categories : []
  }));
}

export default function Home() {
  // --- STATE ---
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [aiScores, setAiScores] = useState<Record<string, AIScore>>({});
  const [loading, setLoading] = useState(true);
  
  // API Fetch Statuses
  const [fetchStatus, setFetchStatus] = useState<Record<string, FetchStatus>>({
    remotive: { status: "loading", msg: "Cargando..." },
    remoteok: { status: "loading", msg: "Cargando..." },
    jooble: { status: "loading", msg: "Cargando..." },
    muse: { status: "loading", msg: "Cargando..." },
    wwr: { status: "loading", msg: "Cargando..." },
    arbeitnow: { status: "loading", msg: "Cargando..." },
    getonbrd: { status: "loading", msg: "Cargando..." },
    remotojob: { status: "loading", msg: "Cargando..." },
    findjobit: { status: "loading", msg: "Cargando..." }
  });

  // UI state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCVExpanded, setIsCVExpanded] = useState(false);
  const [isShowingSavedOnly, setIsShowingSavedOnly] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(30);
  const [cvText, setCvText] = useState("");
  const [isAnalyzingCV, setIsAnalyzingCV] = useState(false);

  // Settings
  const [settings, setSettings] = useState<AppSettings>({
    joobleKey: "",
    groqKey: "",
    anthropicKey: "",
    aiProvider: "groq"
  });

  // Filters state
  const [keywordInput, setKeywordInput] = useState("");
  const [activeFilters, setActiveFilters] = useState({
    keyword: "",
    date: "todo",
    relevance: "alta-media",
    categories: [] as string[],
    jobTypes: [] as string[],
    withSalary: false,
    sources: ["remotive", "remoteok", "jooble", "muse", "wwr", "arbeitnow", "getonbrd", "remotojob", "findjobit"] as string[],
    sortBy: "reciente",
    language: "todos"
  });

  // Expandable description card IDs
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  // Debounce ref
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Constants
  const CATEGORIES = ["Tecnología", "Marketing", "Diseño", "Soporte", "Ventas", "Finanzas", "Datos", "Otro"];
  const JOB_TYPES = ["Full-time", "Part-time", "Contrato", "Freelance"];
  const SOURCES = [
    { id: "remotive", label: "Remotive" },
    { id: "remoteok", label: "RemoteOK" },
    { id: "jooble", label: "Jooble" },
    { id: "muse", label: "The Muse" },
    { id: "wwr", label: "We Work Remotely" },
    { id: "arbeitnow", label: "Arbeitnow" },
    { id: "getonbrd", label: "Getonbrd" },
    { id: "remotojob", label: "RemotoJob" },
    { id: "findjobit", label: "Findjobit" }
  ];

  // --- INITIAL LOAD ---
  useEffect(() => {
    // 1. Load Local Storage data
    const storedFavs = localStorage.getItem("tcr_favorites");
    if (storedFavs) {
      try { setFavorites(JSON.parse(storedFavs)); } catch (e) { console.error(e); }
    }

    const storedSettings = localStorage.getItem("tcr_settings");
    let loadedSettings: AppSettings | null = null;
    if (storedSettings) {
      try {
        loadedSettings = JSON.parse(storedSettings);
      } catch (e) {
        console.error(e);
      }
    }

    // Backup individual keys (with environment variable fallbacks)
    const joobleKey = loadedSettings?.joobleKey || localStorage.getItem("tcr_jooble_key") || process.env.NEXT_PUBLIC_JOOBLE_KEY || "";
    const groqKey = loadedSettings?.groqKey || localStorage.getItem("tcr_groq_key") || process.env.NEXT_PUBLIC_GROQ_API_KEY || "";
    const anthropicKey = loadedSettings?.anthropicKey || localStorage.getItem("tcr_anthropic_key") || process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY || "";
    const aiProvider = (loadedSettings?.aiProvider || localStorage.getItem("tcr_ai_provider") || "groq") as "groq" | "anthropic";

    const resolvedSettings: AppSettings = { joobleKey, groqKey, anthropicKey, aiProvider };
    setSettings(resolvedSettings);

    const storedCVScores = localStorage.getItem("tcr_cv_scores");
    if (storedCVScores) {
      try { setAiScores(JSON.parse(storedCVScores)); } catch (e) { console.error(e); }
    }

    const storedCVText = localStorage.getItem("tcr_cv_text");
    if (storedCVText) setCvText(storedCVText);

    // 2. Fetch Jobs client-side
    fetchJobs(joobleKey);
  }, []);

  // --- CLIENT-SIDE FETCH ENGINE ---
  const fetchJobs = async (joobleKeyToUse: string) => {
    setLoading(true);
    
    // Set status of all items to loading
    const initialStatus = {
      remotive: { status: "loading" as const, msg: "Cargando..." },
      remoteok: { status: "loading" as const, msg: "Cargando..." },
      jooble: joobleKeyToUse ? { status: "loading" as const, msg: "Cargando..." } : { status: "not_configured" as const, msg: "Falta API Key" },
      muse: { status: "loading" as const, msg: "Cargando..." },
      wwr: { status: "loading" as const, msg: "Cargando..." },
      arbeitnow: { status: "loading" as const, msg: "Cargando..." },
      getonbrd: { status: "loading" as const, msg: "Cargando..." },
      remotojob: { status: "loading" as const, msg: "Cargando..." },
      findjobit: { status: "loading" as const, msg: "Cargando..." }
    };
    setFetchStatus(initialStatus);

    let combinedJobs: Job[] = [];

    const setSourceStatus = (sourceName: string, status: FetchStatus["status"], msg: string) => {
      setFetchStatus(prev => ({
        ...prev,
        [sourceName]: { status, msg }
      }));
    };

    // Sub-fetchers
    const fetchRemotive = async () => {
      const searchTerms = ["latam", "latin+america", "costa+rica", "worldwide"];
      const jobs: Job[] = [];
      let successCount = 0;

      // 1. Fetch API searches in parallel
      const apiPromises = searchTerms.map(term =>
        fetch(`https://remotive.com/api/remote-jobs?limit=100&search=${term}`, { signal: AbortSignal.timeout(5000) })
          .then(async r => {
            if (!r.ok) throw new Error();
            const data = await r.json();
            return data.jobs || [];
          })
          .catch(() => [])
      );

      // 2. Fetch RSS feed in parallel
      const rssPromise = fetchAndParseRSS("https://remotive.com/remote-jobs/feed")
        .catch(() => []);

      const [apiResults, rssItems] = await Promise.all([
        Promise.all(apiPromises),
        rssPromise
      ]);

      // Parse APIs
      apiResults.forEach(list => {
        if (list.length > 0) successCount++;
        list.forEach((item: any) => {
          const normalized: Partial<Job> = {
            id: `remotive-${item.id}`,
            title: item.title,
            company: item.company_name,
            source: "remotive",
            sourceLabel: "Remotive API",
            date: item.publication_date ? new Date(item.publication_date).toISOString() : new Date().toISOString(),
            url: item.url,
            description: truncateString(item.description || "", 1000),
            tags: (item.tags || []).map((t: string) => t.toLowerCase()),
            location: item.candidate_required_location || "Remote",
            salary: item.salary || null,
            remote: true
          };
          normalized.crRelevance = computeRelevance(normalized);
          normalized.category = categorizeJob(normalized);
          normalized.jobType = classifyJobType(normalized);
          normalized.language = detectLanguage(normalized);
          jobs.push(normalized as Job);
        });
      });

      // Parse RSS
      if (rssItems.length > 0) {
        successCount++;
        rssItems.forEach((item: any, index: number) => {
          const cleanTitle = (item.title || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 15);
          const cleanCompany = (item.author || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 10);
          const idHash = item.link 
            ? item.link.replace(/[^a-zA-Z0-9]/g, "") 
            : `rss-${cleanTitle}-${cleanCompany}-${index}`;
          const normalized: Partial<Job> = {
            id: `remotive-rss-${idHash}`,
            title: item.title,
            company: item.author || "Remotive",
            source: "remotive",
            sourceLabel: "Remotive Feed",
            date: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            url: item.link,
            description: truncateString(item.description || "", 1000),
            tags: (item.categories || []).map((c: string) => c.toLowerCase()),
            location: "Remote",
            salary: null,
            remote: true
          };
          normalized.crRelevance = computeRelevance(normalized);
          normalized.category = categorizeJob(normalized);
          normalized.jobType = classifyJobType(normalized);
          normalized.language = detectLanguage(normalized);
          jobs.push(normalized as Job);
        });
      }

      if (successCount === 0) throw new Error("Fallo de red");
      return jobs;
    };

    const fetchRemoteOK = async () => {
      let rawData;
      try {
        // Try direct fetch
        const res = await fetch("https://remoteok.com/api", { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error();
        rawData = await res.json();
      } catch (e) {
        // CORS bypass proxy
        const res = await fetchViaCorsProxy("https://remoteok.com/api");
        rawData = await res.json();
      }

      if (!Array.isArray(rawData)) throw new Error("Formato inválido");
      
      const items = rawData.slice(1);
      const jobs: Job[] = [];

      items.forEach((item: any) => {
        if (!item.position) return;
        const tags = (item.tags || []).map((t: string) => t.toLowerCase());

        // RemoteOK contains only remote jobs, so we do not restrict by matchFilters tags.
        // We will pass location (if available) to evaluate timezone/geography restrictions.
        const normalized: Partial<Job> = {
          id: `remoteok-${item.id}`,
          title: item.position,
          company: item.company,
          source: "remoteok",
          sourceLabel: "RemoteOK",
          date: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
          url: item.url,
          description: truncateString(item.description || "", 1000),
          tags: tags,
          location: item.location || "Remote",
          salary: item.salary_min && item.salary_max ? `$${(item.salary_min/1000).toFixed(0)}k - $${(item.salary_max/1000).toFixed(0)}k/año` : null,
          remote: true
        };
        normalized.crRelevance = computeRelevance(normalized);
        normalized.category = categorizeJob(normalized);
        normalized.jobType = classifyJobType(normalized);
        normalized.language = detectLanguage(normalized);
        jobs.push(normalized as Job);
      });

      return jobs;
    };

    const fetchJooble = async (key: string) => {
      if (!key) return [];
      const queries = [
        { keywords: "remoto OR remote", location: "Costa Rica", page: 1 },
        { keywords: "tecnologia OR desarrollador OR developer OR soporte OR it", location: "Costa Rica", page: 1 },
        { keywords: "ventas OR administracion OR asistente OR servicio OR conductor OR cajero", location: "Costa Rica", page: 1 },
        { keywords: "", location: "Costa Rica", page: 1 }
      ];
      const jobs: Job[] = [];

      // Use corsproxy.io to bypass browser CORS block for Jooble POST
      const fetchPromises = queries.map(body => 
        fetch(`https://corsproxy.io/?url=${encodeURIComponent(`https://jooble.org/api/${key}`)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000)
        })
        .then(async r => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .catch(() => null)
      );

      const results = await Promise.all(fetchPromises);
      results.forEach(data => {
        if (data && Array.isArray(data.jobs)) {
          data.jobs.forEach((item: any, index: number) => {
            const cleanTitle = (item.title || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 15);
            const cleanCompany = (item.company || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 10);
            const idHash = item.link 
              ? item.link.replace(/[^a-zA-Z0-9]/g, "") 
              : `jooble-${cleanTitle}-${cleanCompany}-${index}`;
            const normalized: Partial<Job> = {
              id: `jooble-${idHash}`,
              title: item.title,
              company: item.company || "Desconocida",
              source: "jooble",
              sourceLabel: "Jooble",
              date: item.updated ? new Date(item.updated).toISOString() : new Date().toISOString(),
              url: item.link,
              description: truncateString(item.snippet || "", 1000),
              tags: (item.location || "").toLowerCase().includes("remot") || (item.title || "").toLowerCase().includes("remot")
                ? ["remote", "costa rica"]
                : ["local", "costa rica"],
              location: item.location || "Costa Rica",
              salary: item.salary || null,
              remote: (item.location || "").toLowerCase().includes("remot") || item.title.toLowerCase().includes("remot")
            };
            normalized.crRelevance = computeRelevance(normalized);
            normalized.category = categorizeJob(normalized);
            normalized.jobType = classifyJobType(normalized);
            normalized.language = detectLanguage(normalized);
            jobs.push(normalized as Job);
          });
        }
      });

      return jobs;
    };

    const fetchMuse = async () => {
      const pages = [0, 1];
      const fetchPromises = pages.map(page =>
        fetch(`https://www.themuse.com/api/public/jobs?page=${page}&descending=true`, { signal: AbortSignal.timeout(5000) })
          .then(async r => {
            if (!r.ok) throw new Error();
            return r.json();
          })
          .catch(() => null)
      );

      const results = await Promise.all(fetchPromises);
      const jobs: Job[] = [];

      results.forEach(data => {
        if (data && Array.isArray(data.results)) {
          data.results.forEach((item: any) => {
            const locs = item.locations || [];
            const isRemote = locs.some((l: any) => l.name.toLowerCase().includes("remote") || l.name.toLowerCase().includes("flexible"));
            const hasCompanySize = !!item.company_size;

            if (!isRemote && !hasCompanySize) return;

            const normalized: Partial<Job> = {
              id: `muse-${item.id}`,
              title: item.name,
              company: item.company ? item.company.name : "The Muse Co",
              source: "muse",
              sourceLabel: "The Muse",
              date: item.publication_date ? new Date(item.publication_date).toISOString() : new Date().toISOString(),
              url: item.refs ? item.refs.landing_page : "",
              description: truncateString(item.contents || "", 1000),
              tags: (item.categories || []).map((c: any) => c.name.toLowerCase()).concat((item.levels || []).map((l: any) => l.name.toLowerCase())),
              location: locs.map((l: any) => l.name).join(", ") || "Remote",
              salary: null,
              remote: isRemote
            };
            normalized.crRelevance = computeRelevance(normalized);
            normalized.category = categorizeJob(normalized);
            normalized.jobType = classifyJobType(normalized);
            normalized.language = detectLanguage(normalized);
            jobs.push(normalized as Job);
          });
        }
      });

      return jobs;
    };

    const fetchWWR = async () => {
      const items = await fetchAndParseRSS("https://weworkremotely.com/remote-jobs.rss");
      const jobs: Job[] = [];

      items.forEach((item: any, index: number) => {
        const cleanTitle = (item.title || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 15);
        const cleanCompany = (item.author || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 10);
        const idHash = item.link 
          ? item.link.replace(/[^a-zA-Z0-9]/g, "") 
          : `wwr-${cleanTitle}-${cleanCompany}-${index}`;
        const normalized: Partial<Job> = {
          id: `wwr-${idHash}`,
          title: item.title,
          company: item.author || "We Work Remotely",
          source: "wwr",
          sourceLabel: "We Work Remotely",
          date: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          url: item.link,
          description: truncateString(item.description || "", 1000),
          tags: (item.categories || []).map((c: string) => c.toLowerCase()),
          location: "Remote",
          salary: null,
          remote: true
        };
        normalized.crRelevance = computeRelevance(normalized);
        normalized.category = categorizeJob(normalized);
        normalized.jobType = classifyJobType(normalized);
        normalized.language = detectLanguage(normalized);
        jobs.push(normalized as Job);
      });

      return jobs;
    };

    const fetchArbeitnow = async () => {
      let rawData;
      try {
        const res = await fetch("https://www.arbeitnow.com/api/job-board-api", { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error();
        rawData = await res.json();
      } catch (e) {
        const res = await fetchViaCorsProxy("https://www.arbeitnow.com/api/job-board-api");
        rawData = await res.json();
      }

      if (!rawData || !Array.isArray(rawData.data)) throw new Error("Formato inválido");
      
      const jobs: Job[] = [];
      rawData.data.forEach((item: any) => {
        const normalized: Partial<Job> = {
          id: `arbeitnow-${item.slug}`,
          title: item.title,
          company: item.company_name,
          source: "arbeitnow",
          sourceLabel: "Arbeitnow",
          date: item.created_at ? new Date(item.created_at).toISOString() : new Date().toISOString(),
          url: item.url,
          description: truncateString(item.description || "", 1000),
          tags: (item.tags || []).map((t: string) => t.toLowerCase()),
          location: item.location || "Remote",
          salary: null,
          remote: item.remote || false
        };
        normalized.crRelevance = computeRelevance(normalized);
        normalized.category = categorizeJob(normalized);
        normalized.jobType = classifyJobType(normalized);
        normalized.language = detectLanguage(normalized);
        jobs.push(normalized as Job);
      });

      return jobs;
    };

    const fetchGetonbrd = async () => {
      const queries = ["costa+rica", "latam"];
      const jobs: Job[] = [];
      let successCount = 0;

      const fetchPromises = queries.map(query => {
        const url = `https://www.getonbrd.com/api/v0/search/jobs?query=${query}&expand[]=company`;
        return fetch(url, { signal: AbortSignal.timeout(4000) })
          .then(async r => {
            if (!r.ok) throw new Error();
            return r.json();
          })
          .catch(async () => {
            try {
              const res = await fetchViaCorsProxy(url);
              return res.json();
            } catch (e) {
              return null;
            }
          });
      });

      const results = await Promise.all(fetchPromises);
      results.forEach(data => {
        if (data && Array.isArray(data.data)) {
          successCount++;
          data.data.forEach((item: any) => {
            const attrs = item.attributes || {};
            const companyData = attrs.company?.data?.attributes || {};
            
            const dateStr = attrs.published_at 
              ? new Date(attrs.published_at * 1000).toISOString() 
              : new Date().toISOString();

            const normalized: Partial<Job> = {
              id: `getonbrd-${item.id}`,
              title: attrs.title,
              company: companyData.name || "Getonbrd Company",
              source: "getonbrd",
              sourceLabel: "Getonbrd",
              date: dateStr,
              url: item.links?.public_url || attrs.link || `https://www.getonbrd.com/jobs/${item.id}`,
              description: truncateString(attrs.description || "", 1000),
              tags: [attrs.category_name || "", attrs.job_level || ""].filter(Boolean).map((t: string) => t.toLowerCase()),
              location: attrs.remote_modality === "fully_remote" ? "Remote" : (attrs.remote_modality || "Remote"),
              salary: attrs.min_salary && attrs.max_salary ? `$${attrs.min_salary} - $${attrs.max_salary} USD` : null,
              remote: attrs.remote || attrs.remote_modality === "fully_remote" || attrs.remote_modality === "remote_local"
            };
            normalized.crRelevance = computeRelevance(normalized);
            normalized.category = categorizeJob(normalized);
            normalized.jobType = classifyJobType(normalized);
            normalized.language = detectLanguage(normalized);
            jobs.push(normalized as Job);
          });
        }
      });

      if (successCount === 0) throw new Error("Fallo de red");
      return jobs;
    };

    const fetchRemotoJob = async () => {
      const items = await fetchAndParseRSS("https://remotojob.com/feed/");
      const jobs: Job[] = [];

      items.forEach((item: any, index: number) => {
        const cleanTitle = (item.title || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 15);
        const cleanCompany = (item.author || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 10);
        const idHash = item.link 
          ? item.link.replace(/[^a-zA-Z0-9]/g, "") 
          : `remotojob-${cleanTitle}-${cleanCompany}-${index}`;
        const normalized: Partial<Job> = {
          id: `remotojob-${idHash}`,
          title: item.title,
          company: item.author || "RemotoJob",
          source: "remotojob",
          sourceLabel: "RemotoJob",
          date: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
          url: item.link,
          description: truncateString(item.description || "", 1000),
          tags: (item.categories || []).map((c: string) => c.toLowerCase()),
          location: "Remote / LATAM",
          salary: null,
          remote: true
        };
        normalized.crRelevance = computeRelevance(normalized);
        normalized.category = categorizeJob(normalized);
        normalized.jobType = classifyJobType(normalized);
        normalized.language = detectLanguage(normalized);
        jobs.push(normalized as Job);
      });

      return jobs;
    };

    const fetchFindjobit = async () => {
      const crPromise = fetchAndParseRSS("https://findjobit.com/rss/costa-rica").catch(() => []);
      const generalPromise = fetchAndParseRSS("https://findjobit.com/jobs/feed").catch(() => []);
      const [crItems, generalItems] = await Promise.all([crPromise, generalPromise]);
      const jobs: Job[] = [];

      const processItems = (items: any[], isCrSpecific: boolean) => {
        items.forEach((item: any, index: number) => {
          const cleanTitle = (item.title || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 15);
          const cleanCompany = (item.author || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().substring(0, 10);
          const idHash = item.link 
            ? item.link.replace(/[^a-zA-Z0-9]/g, "") 
            : `findjobit-${cleanTitle}-${cleanCompany}-${index}`;
          const normalized: Partial<Job> = {
            id: `findjobit-${idHash}`,
            title: item.title,
            company: item.author || "Findjobit",
            source: "findjobit",
            sourceLabel: "Findjobit",
            date: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            url: item.link,
            description: truncateString(item.description || "", 1000),
            tags: (item.categories || []).map((c: string) => c.toLowerCase()),
            location: isCrSpecific ? "Costa Rica" : "Remote / LATAM",
            salary: null,
            remote: true
          };
          normalized.crRelevance = isCrSpecific ? "high" : computeRelevance(normalized);
          normalized.category = categorizeJob(normalized);
          normalized.jobType = classifyJobType(normalized);
          normalized.language = detectLanguage(normalized);
          jobs.push(normalized as Job);
        });
      };

      processItems(crItems, true);
      processItems(generalItems, false);

      if (crItems.length === 0 && generalItems.length === 0) {
        throw new Error("Ambos feeds de Findjobit fallaron");
      }

      return jobs;
    };

    // Parallel execution
    const promises = [
      fetchRemotive()
        .then(jobs => {
          setSourceStatus("remotive", "loaded", "Cargado");
          combinedJobs = combinedJobs.concat(jobs);
        })
        .catch(e => setSourceStatus("remotive", "failed", e.message || "Fallo al conectar")),
      
      fetchRemoteOK()
        .then(jobs => {
          setSourceStatus("remoteok", "loaded", "Cargado");
          combinedJobs = combinedJobs.concat(jobs);
        })
        .catch(e => setSourceStatus("remoteok", "failed", e.message || "Fallo al conectar")),
      
      (joobleKeyToUse ? fetchJooble(joobleKeyToUse) : Promise.resolve([]))
        .then(jobs => {
          if (joobleKeyToUse) {
            setSourceStatus("jooble", "loaded", "Cargado");
            combinedJobs = combinedJobs.concat(jobs);
          }
        })
        .catch(e => setSourceStatus("jooble", "failed", e.message || "Fallo al conectar")),

      fetchMuse()
        .then(jobs => {
          setSourceStatus("muse", "loaded", "Cargado");
          combinedJobs = combinedJobs.concat(jobs);
        })
        .catch(e => setSourceStatus("muse", "failed", e.message || "Fallo al conectar")),

      fetchWWR()
        .then(jobs => {
          setSourceStatus("wwr", "loaded", "Cargado");
          combinedJobs = combinedJobs.concat(jobs);
        })
        .catch(e => setSourceStatus("wwr", "failed", e.message || "Fallo al conectar")),

      fetchArbeitnow()
        .then(jobs => {
          setSourceStatus("arbeitnow", "loaded", "Cargado");
          combinedJobs = combinedJobs.concat(jobs);
        })
        .catch(e => setSourceStatus("arbeitnow", "failed", e.message || "Fallo al conectar")),

      fetchGetonbrd()
        .then(jobs => {
          setSourceStatus("getonbrd", "loaded", "Cargado");
          combinedJobs = combinedJobs.concat(jobs);
        })
        .catch(e => setSourceStatus("getonbrd", "failed", e.message || "Fallo al conectar")),

      fetchRemotoJob()
        .then(jobs => {
          setSourceStatus("remotojob", "loaded", "Cargado");
          combinedJobs = combinedJobs.concat(jobs);
        })
        .catch(e => setSourceStatus("remotojob", "failed", e.message || "Fallo al conectar")),

      fetchFindjobit()
        .then(jobs => {
          setSourceStatus("findjobit", "loaded", "Cargado");
          combinedJobs = combinedJobs.concat(jobs);
        })
        .catch(e => setSourceStatus("findjobit", "failed", e.message || "Fallo al conectar"))
    ];

    await Promise.allSettled(promises);

    // Geographic filtering: keep all jobs in memory (allow UI filtering)
    const crFiltered = combinedJobs;

    // Deduplicate by title & company
    const deduplicatedMap = new Map<string, Job>();
    crFiltered.forEach(job => {
      const key = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
      if (!deduplicatedMap.has(key)) {
        deduplicatedMap.set(key, job);
      } else {
        const existing = deduplicatedMap.get(key)!;
        if (!existing.salary && job.salary) {
          deduplicatedMap.set(key, job);
        } else if (job.description.length > existing.description.length) {
          deduplicatedMap.set(key, job);
        }
      }
    });

    // Protect against duplicate IDs in final render list
    const finalIdMap = new Map<string, Job>();
    Array.from(deduplicatedMap.values()).forEach(job => {
      finalIdMap.set(job.id, job);
    });

    const jobsList = Array.from(finalIdMap.values());
    jobsList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setAllJobs(jobsList);
    setLoading(false);
  };

  // --- FILTER & SORT LOGIC ---
  const handleKeywordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setKeywordInput(val);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setActiveFilters(prev => ({ ...prev, keyword: val.trim().toLowerCase() }));
      setDisplayLimit(30);
    }, 300);
  };

  const toggleCategory = (cat: string) => {
    setActiveFilters(prev => {
      const exists = prev.categories.includes(cat);
      const nextCats = exists
        ? prev.categories.filter(c => c !== cat)
        : [...prev.categories, cat];
      return { ...prev, categories: nextCats };
    });
    setDisplayLimit(30);
  };

  const toggleJobType = (type: string) => {
    setActiveFilters(prev => {
      const exists = prev.jobTypes.includes(type);
      const nextTypes = exists
        ? prev.jobTypes.filter(t => t !== type)
        : [...prev.jobTypes, type];
      return { ...prev, jobTypes: nextTypes };
    });
    setDisplayLimit(30);
  };

  const toggleSource = (sourceId: string) => {
    setActiveFilters(prev => {
      const exists = prev.sources.includes(sourceId);
      const nextSources = exists
        ? prev.sources.filter(s => s !== sourceId)
        : [...prev.sources, sourceId];
      return { ...prev, sources: nextSources };
    });
    setDisplayLimit(30);
  };

  // Filter & sort application
  const filteredJobs = allJobs.filter(job => {
    // 1. Favorites toggle
    if (isShowingSavedOnly && !favorites.includes(job.id)) return false;

    // 2. Keyword Filter
    if (activeFilters.keyword) {
      const searchSpace = `${job.title} ${job.company} ${job.description} ${(job.tags || []).join(" ")}`.toLowerCase();
      if (!searchSpace.includes(activeFilters.keyword)) return false;
    }

    // 3. Date Filter
    if (activeFilters.date !== "todo") {
      const now = new Date();
      const jobDate = new Date(job.date);
      const diffDays = (now.getTime() - jobDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (activeFilters.date === "hoy" && diffDays > 1) return false;
      if (activeFilters.date === "semana" && diffDays > 7) return false;
      if (activeFilters.date === "mes" && diffDays > 30) return false;
    }

    // 4. Relevance CR
    if (activeFilters.relevance !== "todas") {
      if (activeFilters.relevance === "alta" && job.crRelevance !== "high") return false;
      if (activeFilters.relevance === "alta-media" && job.crRelevance !== "high" && job.crRelevance !== "medium") return false;
    }

    // 5. Categories
    if (activeFilters.categories.length > 0 && !activeFilters.categories.includes(job.category)) return false;

    // 6. Job Types
    if (activeFilters.jobTypes.length > 0 && !activeFilters.jobTypes.includes(job.jobType)) return false;

    // 7. Salary toggle
    if (activeFilters.withSalary && !job.salary) return false;

    // 8. Sources
    if (!activeFilters.sources.includes(job.source)) return false;

    // 9. Language Filter
    if (activeFilters.language !== "todos") {
      if (activeFilters.language === "es" && job.language !== "es") return false;
      if (activeFilters.language === "en" && job.language !== "en") return false;
    }

    return true;
  });

  // Sort application
  const sortedJobs = [...filteredJobs].sort((a, b) => {
    if (activeFilters.sortBy === "reciente") {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    }
    
    if (activeFilters.sortBy === "relevancia_cr") {
      const getWeight = (rel: string) => rel === "high" ? 3 : (rel === "medium" ? 2 : 1);
      const diff = getWeight(b.crRelevance) - getWeight(a.crRelevance);
      if (diff !== 0) return diff;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    }

    if (activeFilters.sortBy === "compatibilidad") {
      const scoreA = aiScores[a.id]?.score || 0;
      const scoreB = aiScores[b.id]?.score || 0;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    }

    return 0;
  });

  const resetAllFilters = () => {
    setKeywordInput("");
    setActiveFilters({
      keyword: "",
      date: "todo",
      relevance: "alta-media",
      categories: [],
      jobTypes: [],
      withSalary: false,
      sources: ["remotive", "remoteok", "jooble", "muse", "wwr", "arbeitnow", "getonbrd", "remotojob", "findjobit"],
      sortBy: "reciente",
      language: "todos"
    });
    setDisplayLimit(30);
  };

  // --- FAVORITES ACTION ---
  const toggleFavorite = (jobId: string) => {
    const isFav = favorites.includes(jobId);
    let nextFavs: string[] = [];
    if (isFav) {
      nextFavs = favorites.filter(id => id !== jobId);
    } else {
      nextFavs = [...favorites, jobId];
    }
    setFavorites(nextFavs);
    localStorage.setItem("tcr_favorites", JSON.stringify(nextFavs));
  };

  // --- SETTINGS ACTIONS ---
  const saveSettings = (updated: AppSettings) => {
    setSettings(updated);
    localStorage.setItem("tcr_settings", JSON.stringify(updated));
    localStorage.setItem("tcr_jooble_key", updated.joobleKey);
    localStorage.setItem("tcr_groq_key", updated.groqKey);
    localStorage.setItem("tcr_anthropic_key", updated.anthropicKey);
    localStorage.setItem("tcr_ai_provider", updated.aiProvider);
    setIsSettingsOpen(false);

    // Re-fetch jobs
    fetchJobs(updated.joobleKey);
  };

  // --- CV MATCHER RUN ---
  const runCVAnalysis = async () => {
    if (!cvText.trim()) {
      alert("Por favor, pegá el texto de tu currículum antes de realizar el análisis.");
      return;
    }

    const providerKey = settings.aiProvider === "groq" ? settings.groqKey : settings.anthropicKey;
    if (!providerKey) {
      alert(`Falta configurar la clave API para el proveedor de IA (${settings.aiProvider === "groq" ? "Groq" : "Anthropic"}).`);
      setIsSettingsOpen(true);
      return;
    }

    if (allJobs.length === 0) {
      alert("Aún no hay ofertas cargadas para comparar.");
      return;
    }

    setIsAnalyzingCV(true);

    // Get top 30 jobs sorted by date
    const jobsToSend = [...allJobs]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 30);

    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cvText,
          jobs: jobsToSend,
          provider: settings.aiProvider,
          apiKey: providerKey
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Fallo en llamada del servidor");
      }

      const data = await res.json();
      const results: { id: string; score: number; reason: string }[] = data.results || [];

      const nextScores: Record<string, AIScore> = {};
      results.forEach(item => {
        if (item && item.id !== undefined && item.score !== undefined) {
          nextScores[item.id] = {
            score: Number(item.score) || 0,
            reason: item.reason || ""
          };
        }
      });

      setAiScores(nextScores);
      localStorage.setItem("tcr_cv_scores", JSON.stringify(nextScores));
      localStorage.setItem("tcr_cv_text", cvText);

      // Auto sort by compatibilidad
      setActiveFilters(prev => ({ ...prev, sortBy: "compatibilidad" }));
      setIsCVExpanded(false); // collapse panel on success
      alert("Análisis completado. Los puestos se ordenaron por compatibilidad con tu CV.");

    } catch (err: any) {
      console.error(err);
      alert(`Error al evaluar compatibilidad de CV: ${err.message}`);
    } finally {
      setIsAnalyzingCV(false);
    }
  };

  const clearCVAnalysis = () => {
    setAiScores({});
    setCvText("");
    localStorage.removeItem("tcr_cv_scores");
    localStorage.removeItem("tcr_cv_text");
    if (activeFilters.sortBy === "compatibilidad") {
      setActiveFilters(prev => ({ ...prev, sortBy: "reciente" }));
    }
  };

  // --- TIME AGO IN SPANISH ---
  const formatTimeAgo = (dateStr: string) => {
    if (!dateStr) return "Desconocido";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    
    if (isNaN(date.getTime())) return "Desconocido";
    
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    
    if (diffSecs < 60) return "Hace un momento";
    if (diffMins < 60) return `hace ${diffMins} min`;
    if (diffHours < 24) return `hace ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
    if (diffDays === 1) return "ayer";
    if (diffDays < 7) return `hace ${diffDays} días`;
    if (diffWeeks === 1) return "hace 1 semana";
    if (diffWeeks < 4) return `hace ${diffWeeks} semanas`;
    if (diffMonths === 1) return "hace 1 mes";
    return `hace ${diffMonths} meses`;
  };

  // --- RENDER PIECES ---
  const sourceColors: Record<string, string> = {
    remotive: "bg-blue-50 text-blue-700 border-blue-200",
    remoteok: "bg-amber-50 text-amber-700 border-amber-200",
    jooble: "bg-green-50 text-green-700 border-green-200",
    muse: "bg-purple-50 text-purple-700 border-purple-200",
    wwr: "bg-red-50 text-red-700 border-red-200",
    arbeitnow: "bg-teal-50 text-teal-700 border-teal-200",
    getonbrd: "bg-indigo-50 text-indigo-700 border-indigo-200",
    remotojob: "bg-rose-50 text-rose-700 border-rose-200",
    findjobit: "bg-cyan-50 text-cyan-700 border-cyan-200"
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "#22c55e";
    if (score >= 60) return "#f59e0b";
    if (score >= 40) return "#f97316";
    return "#ef4444";
  };

  const isAIKeyConfigured = settings.aiProvider === "groq" ? !!settings.groqKey : !!settings.anthropicKey;
  const isCVParsed = Object.keys(aiScores).length > 0;

  return (
    <>
      {/* HEADER */}
      <header className="bg-navy text-white shadow-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-primary text-white p-2 rounded-lg font-bold text-xl shadow-sm tracking-wider flex items-center">
              TrabajoCR <span className="ml-2 text-2xl leading-none">🇨🇷</span>
            </div>
            <div className="hidden sm:block text-xs text-slate-400 border-l border-slate-700 pl-3">
              Agregador de empleos y validador de CV
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setIsShowingSavedOnly(!isShowingSavedOnly)}
              className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center space-x-1.5 transition-colors border ${
                isShowingSavedOnly 
                  ? "bg-amber-600 border-amber-500 text-white" 
                  : "bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700"
              }`}
            >
              <Star className={`w-4 h-4 ${isShowingSavedOnly ? "fill-current text-white" : "text-amber-500 fill-current"}`} />
              <span>Guardados</span>
              <span className="bg-accent text-white text-xs px-2 py-0.5 rounded-full font-bold ml-1">{favorites.length}</span>
            </button>

            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700" 
              title="Configuración de APIs"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* MAIN CONTENT CONTAINER */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 py-6 space-y-6">

        {/* STICKY FILTERS PANEL */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
          
          {/* Row 1: Search, Date, Relevance, Salario, Sort */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            {/* Search Input */}
            <div className="lg:col-span-3 relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-5 h-5" />
              </div>
              <input 
                type="text" 
                value={keywordInput}
                onChange={handleKeywordChange}
                placeholder="Buscar cargo, empresa, palabras clave..." 
                className="pl-10 pr-4 py-2 w-full border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all placeholder-slate-400 text-slate-700"
              />
            </div>

            {/* Language Filter */}
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Idioma</label>
              <select 
                value={activeFilters.language}
                onChange={(e) => { setActiveFilters(prev => ({ ...prev, language: e.target.value })); setDisplayLimit(30); }}
                className="w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-white text-slate-700"
              >
                <option value="todos">Cualquier idioma</option>
                <option value="es">🇪🇸 Sólo Español</option>
                <option value="en">🇬🇧 Sólo Inglés</option>
              </select>
            </div>

            {/* Date Filter */}
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Fecha</label>
              <select 
                value={activeFilters.date}
                onChange={(e) => { setActiveFilters(prev => ({ ...prev, date: e.target.value })); setDisplayLimit(30); }}
                className="w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-white text-slate-700"
              >
                <option value="todo">Cualquier fecha</option>
                <option value="hoy">Hoy</option>
                <option value="semana">Última semana</option>
                <option value="mes">Último mes</option>
              </select>
            </div>

            {/* Relevance CR */}
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Relevancia Costa Rica</label>
              <select 
                value={activeFilters.relevance}
                onChange={(e) => { setActiveFilters(prev => ({ ...prev, relevance: e.target.value })); setDisplayLimit(30); }}
                className="w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-white text-slate-700"
              >
                <option value="alta-media">Alta + Media (Default)</option>
                <option value="alta">Alta solamente</option>
                <option value="todas">Todas</option>
              </select>
            </div>

            {/* Con Salario Toggle */}
            <div className="lg:col-span-2 flex items-center justify-start pt-4 lg:pt-0">
              <label className="inline-flex items-center cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={activeFilters.withSalary}
                  onChange={(e) => { setActiveFilters(prev => ({ ...prev, withSalary: e.target.checked })); setDisplayLimit(30); }}
                  className="sr-only peer"
                />
                <div className="relative w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-success"></div>
                <span className="ms-3 text-sm font-medium text-slate-700">Con Salario</span>
              </label>
            </div>

            {/* Sort by */}
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Ordenar por</label>
              <select 
                value={activeFilters.sortBy}
                onChange={(e) => { setActiveFilters(prev => ({ ...prev, sortBy: e.target.value })); setDisplayLimit(30); }}
                className="w-full border border-slate-300 rounded-lg py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-medium bg-white text-slate-700"
              >
                <option value="reciente">Más reciente</option>
                <option value="relevancia_cr">Mayor relevancia CR</option>
                <option value="compatibilidad" disabled={!isCVParsed} className={!isCVParsed ? "text-slate-400" : ""}>
                  Mayor compatibilidad (CV)
                </option>
              </select>
            </div>
          </div>

          {/* Row 2: Categories, Job Types, Sources */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 pt-4 border-t border-slate-100">
            {/* Categories pills */}
            <div className="md:col-span-5">
              <span className="block text-xs font-semibold text-slate-500 mb-2">Categorías</span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(cat => {
                  const active = activeFilters.categories.includes(cat);
                  return (
                    <button
                      key={cat}
                      onClick={() => toggleCategory(cat)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors focus:outline-none ${
                        active 
                          ? "bg-primary text-white border-primary" 
                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-350"
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Job Types pills */}
            <div className="md:col-span-4">
              <span className="block text-xs font-semibold text-slate-500 mb-2">Tipo de Empleo</span>
              <div className="flex flex-wrap gap-2">
                {JOB_TYPES.map(type => {
                  const active = activeFilters.jobTypes.includes(type);
                  return (
                    <button
                      key={type}
                      onClick={() => toggleJobType(type)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors focus:outline-none ${
                        active 
                          ? "bg-primary text-white border-primary" 
                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-350"
                      }`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Source checkboxes */}
            <div className="md:col-span-3">
              <span className="block text-xs font-semibold text-slate-500 mb-2">Fuentes</span>
              <div className="grid grid-cols-2 gap-2 text-xs font-medium text-slate-700">
                {SOURCES.map(src => {
                  const active = activeFilters.sources.includes(src.id);
                  return (
                    <label key={src.id} className="flex items-center space-x-2 cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        checked={active}
                        onChange={() => toggleSource(src.id)}
                        className="w-4 h-4 rounded text-primary focus:ring-primary border-slate-300"
                      />
                      <span>{src.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* STATUS & LIVE COUNT BAR */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs px-1">
          {/* Live count */}
          <div className="text-slate-500 font-medium bg-slate-100 rounded-lg py-1.5 px-3 border border-slate-200">
            {loading ? (
              <span className="flex items-center space-x-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                <span>Cargando ofertas de empleo...</span>
              </span>
            ) : (
              <>
                <span className="font-bold text-slate-800">{sortedJobs.length}</span> empleos de{" "}
                <span className="font-bold text-slate-800">
                  {Object.values(fetchStatus).filter(s => s.status === "loaded").length}
                </span>{" "}
                fuentes ·{" "}
                <span className="font-bold text-success">
                  {sortedJobs.filter(j => j.crRelevance === "high").length}
                </span>{" "}
                muy relevantes para CR
              </>
            )}
          </div>

          {/* Sources status pills */}
          <div className="flex flex-wrap gap-2">
            {SOURCES.map(src => {
              const statusObj = fetchStatus[src.id] || { status: "loading", msg: "Esperando..." };
              
              let colorClass = "bg-slate-100 text-slate-500 border-slate-200";
              let statusText = "⏳";
              let tooltip = statusObj.msg;

              if (statusObj.status === "loaded") {
                colorClass = "bg-green-50 text-green-700 border-green-200";
                statusText = "✓";
                tooltip = "Cargado correctamente";
              } else if (statusObj.status === "failed") {
                colorClass = "bg-red-50 text-red-700 border-red-200";
                statusText = "✗";
                tooltip = `Fallo: ${statusObj.msg}`;
              } else if (statusObj.status === "not_configured") {
                colorClass = "bg-slate-100 text-slate-400 border-slate-200 opacity-60";
                statusText = "⚪";
                tooltip = "Falta clave API en ajustes";
              }

              return (
                <span 
                  key={src.id}
                  title={tooltip}
                  className={`${colorClass} border text-[11px] px-2.5 py-1 rounded-full font-medium flex items-center space-x-1.5 transition-all`}
                >
                  <span>{src.label}</span>
                  <span className="font-bold">{statusText}</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* CV MATCHER PANEL (Collapsible) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button 
            onClick={() => setIsCVExpanded(!isCVExpanded)}
            className="w-full px-5 py-4 flex items-center justify-between bg-slate-50 hover:bg-slate-100 transition-colors focus:outline-none"
          >
            <div className="flex items-center space-x-2.5">
              <span className="text-lg">🎯</span>
              <span className="font-semibold text-slate-800 text-sm md:text-base">Analizar compatibilidad de mi CV</span>
              {isCVParsed && (
                <span className="bg-green-100 text-green-700 border border-green-300 text-xs px-2.5 py-0.5 rounded-full font-semibold">
                  Análisis Activo
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2 text-slate-550">
              <span className="text-xs hidden md:inline font-medium mr-2">
                Proveedor: {settings.aiProvider === "groq" ? "Groq (Llama 3)" : "Anthropic (Claude 3.5)"}
              </span>
              <ChevronDown className={`w-5 h-5 transform transition-transform ${isCVExpanded ? "rotate-180" : ""}`} />
            </div>
          </button>

          {isCVExpanded && (
            <div className="border-t border-slate-200 p-5 bg-white space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">
                Ingresá el texto de tu currículum para compararlo automáticamente mediante Inteligencia Artificial con las ofertas de trabajo disponibles. Evaluaremos tus habilidades técnicas, nivel de idiomas, zona horaria y salario contra cada oferta.
              </p>

              <div className="space-y-2">
                <textarea 
                  value={cvText}
                  onChange={(e) => setCvText(e.target.value)}
                  rows={5} 
                  placeholder="Pegá el texto de tu CV aquí (experiencia, educación, lenguajes, tecnologías)..." 
                  className="w-full p-3 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all custom-scrollbar font-mono text-slate-700"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex space-x-3">
                  <button 
                    onClick={runCVAnalysis}
                    disabled={isAnalyzingCV}
                    className="bg-accent hover:bg-accent-dark text-white px-5 py-2 rounded-lg text-sm font-semibold flex items-center space-x-2 transition-all shadow-sm disabled:opacity-60"
                  >
                    {isAnalyzingCV ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Analizando {Math.min(allJobs.length, 30)} empleos...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        <span>Analizar empleos compatibles ↗</span>
                      </>
                    )}
                  </button>
                  {isCVParsed && (
                    <button 
                      onClick={clearCVAnalysis}
                      className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                    >
                      Limpiar análisis
                    </button>
                  )}
                </div>

                <button 
                  onClick={() => setIsSettingsOpen(true)}
                  className="text-slate-500 hover:text-slate-800 text-xs font-semibold flex items-center space-x-1.5 transition-colors"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Configurar proveedor de IA</span>
                </button>
              </div>

              {!isAIKeyConfigured && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3.5 text-xs flex items-start space-x-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Requiere Configuración</span>: Para utilizar el comparador de currículum, debés registrar tu clave API en la configuración.
                    <button 
                      onClick={() => setIsSettingsOpen(true)}
                      className="underline font-bold ml-1.5 hover:text-amber-950"
                    >
                      Configurar claves ahora
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* JOBS GRID SECTION */}
        <div className="space-y-6">
          
          {loading ? (
            /* Show Skeletons */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="animate-pulse bg-white rounded-xl p-6 border border-slate-200 shadow-sm space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="h-4 bg-slate-200 rounded w-1/4"></div>
                    <div className="h-4 bg-slate-200 rounded w-8"></div>
                  </div>
                  <div className="space-y-2">
                    <div className="h-5 bg-slate-350 rounded w-3/4"></div>
                    <div className="h-5 bg-slate-350 rounded w-1/2"></div>
                  </div>
                  <div className="flex space-x-2 pt-1">
                    <div className="h-5 bg-slate-200 rounded w-20"></div>
                    <div className="h-5 bg-slate-200 rounded w-20"></div>
                  </div>
                  <div className="h-16 bg-slate-200 rounded"></div>
                  <div className="flex space-x-2 pt-2">
                    <div className="h-9 bg-slate-200 rounded w-24"></div>
                    <div className="h-9 bg-slate-200 rounded w-24"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : sortedJobs.length === 0 ? (
            /* Empty State */
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center max-w-xl mx-auto space-y-4">
              <div className="text-4xl">🔍</div>
              <h3 className="font-bold text-lg text-slate-800">No encontramos empleos con esos filtros</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Probá ampliando el rango de fechas, seleccionando más fuentes, o incluyendo todas las categorías y niveles de relevancia de Costa Rica.
              </p>
              <button 
                onClick={resetAllFilters}
                className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                Restablecer filtros
              </button>
            </div>
          ) : (
            /* Job Grid */
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sortedJobs.slice(0, displayLimit).map(job => {
                  const isFav = favorites.includes(job.id);
                  const scoreObj = aiScores[job.id];
                  const isExpanded = !!expandedCards[job.id];

                  // Description raw preview (stripping tags for safety/length)
                  const cleanedText = job.description
                    ? job.description.replace(/<\/?[^>]+(>|$)/g, "")
                    : "";
                  const previewText = cleanedText.length > 180 ? cleanedText.slice(0, 180) + "..." : cleanedText;
                  const hasMoreDesc = cleanedText.length > 180;

                  return (
                    <div 
                      key={job.id} 
                      className="job-card bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
                    >
                      <div className="space-y-3">
                        {/* Star & Date Row */}
                        <div className="flex justify-between items-center text-[10px] text-slate-400">
                          <span className="font-medium flex items-center">
                            <Clock className="w-3.5 h-3.5 mr-1" />
                            {formatTimeAgo(job.date)}
                          </span>
                          <button 
                            onClick={() => toggleFavorite(job.id)}
                            className="text-slate-400 hover:text-amber-500 transition-colors p-1" 
                            title={isFav ? "Quitar de favoritos" : "Guardar en favoritos"}
                          >
                            <Star className={`w-5 h-5 ${isFav ? "text-amber-500 fill-current" : ""}`} />
                          </button>
                        </div>

                        {/* Company & Source Badge */}
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-slate-500 tracking-wide truncate max-w-[150px]" title={job.company}>
                            {job.company}
                          </span>
                          <span className={`${sourceColors[job.source] || "bg-slate-100 text-slate-700"} border text-[10px] px-2 py-0.5 rounded font-bold`}>
                            {job.sourceLabel}
                          </span>
                        </div>

                        {/* Title */}
                        <h4 className="font-bold text-slate-900 leading-snug hover:text-primary transition-colors text-sm line-clamp-2 h-[2.5rem]" title={job.title}>
                          {job.title}
                        </h4>

                        {/* Relevance and Info chips */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {job.crRelevance === "high" ? (
                            <span className="bg-primary text-white border border-primary text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider">🇨🇷 Alta</span>
                          ) : job.crRelevance === "medium" ? (
                            <span className="bg-slate-100 text-slate-700 border border-slate-350 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider">🌎 Media</span>
                          ) : (
                            <span className="bg-slate-50 text-slate-400 border border-slate-200 text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider">🔵 Baja</span>
                          )}
                          {job.language === "es" ? (
                            <span className="bg-emerald-55 text-emerald-700 border border-emerald-200 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider">🇪🇸 Español</span>
                          ) : (
                            <span className="bg-slate-100 text-slate-500 border border-slate-200 text-[10px] px-2 py-0.5 rounded font-medium uppercase tracking-wider">🇬🇧 Inglés</span>
                          )}
                          <span className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider">{job.jobType}</span>
                          <span className="bg-slate-100 text-slate-600 border border-slate-200 text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wider">{job.category}</span>
                        </div>

                        {/* Salary */}
                        {job.salary && (
                          <div className="text-xs font-bold text-success flex items-center space-x-1 py-1 px-2.5 bg-green-50 border border-green-200 rounded-md w-fit">
                            <DollarSign className="w-3.5 h-3.5" />
                            <span>{job.salary}</span>
                          </div>
                        )}

                        {/* CV Compatibility score ring */}
                        {scoreObj && (
                          <div className="flex items-center space-x-2.5 bg-slate-50 border border-slate-200 rounded-lg p-2 w-full" title={scoreObj.reason}>
                            <div className="relative w-10 h-10 flex items-center justify-center flex-shrink-0">
                              <svg className="w-full h-full transform -rotate-90">
                                <circle cx="20" cy="20" r="18" stroke="#e2e8f0" stroke-width="3" fill="transparent" />
                                <circle 
                                  cx="20" 
                                  cy="20" 
                                  r="18" 
                                  stroke={getScoreColor(scoreObj.score)} 
                                  strokeWidth="3" 
                                  fill="transparent"
                                  strokeDasharray="113.1" 
                                  strokeDashoffset={113.1 - (113.1 * scoreObj.score) / 100}
                                  className="transition-all duration-500 ease-out" 
                                />
                              </svg>
                              <span className="absolute text-[10px] font-bold text-slate-800">{scoreObj.score}%</span>
                            </div>
                            <div className="text-[11px] leading-snug">
                              <span className="font-bold text-slate-700 block">CV Match</span>
                              <span className="text-slate-500 line-clamp-1 italic">"{scoreObj.reason}"</span>
                            </div>
                          </div>
                        )}

                        {/* Description Preview & Toggle */}
                        <div className="text-xs text-slate-600 leading-relaxed pt-1.5 space-y-1.5">
                          {!isExpanded ? (
                            <p className="text-slate-600">{previewText}</p>
                          ) : (
                            <p className="text-slate-600 select-text overflow-x-auto whitespace-pre-line bg-slate-50 p-2.5 rounded-lg border border-slate-150">
                              {cleanedText}
                            </p>
                          )}
                          
                          {hasMoreDesc && (
                            <button 
                              onClick={() => setExpandedCards(prev => ({ ...prev, [job.id]: !isExpanded }))}
                              className="text-primary hover:text-primary-dark font-semibold text-[11px] flex items-center space-x-1 transition-colors focus:outline-none"
                            >
                              <span>{isExpanded ? "Ver menos" : "Ver más"}</span>
                              <ChevronDown className={`w-3.5 h-3.5 transform transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                        <a 
                          href={job.url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex-grow bg-accent hover:bg-accent-dark text-white text-xs font-semibold py-2 px-3 rounded-lg text-center shadow-sm transition-colors flex items-center justify-center space-x-1"
                        >
                          <span>Ver oferta</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <button 
                          onClick={() => toggleFavorite(job.id)}
                          className={`border text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center space-x-1 transition-all ${
                            isFav 
                              ? "bg-amber-50 border-amber-300 text-amber-600" 
                              : "border-slate-300 hover:bg-slate-50 text-slate-600"
                          }`}
                        >
                          <Star className={`w-3.5 h-3.5 ${isFav ? "fill-current text-amber-500" : ""}`} />
                          <span>{isFav ? "Guardado" : "Guardar"}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load More Button */}
              {sortedJobs.length > displayLimit && (
                <div className="flex justify-center pt-4">
                  <button 
                    onClick={() => setDisplayLimit(prev => prev + 30)}
                    className="bg-primary hover:bg-primary-dark text-white font-semibold text-sm px-6 py-2.5 rounded-lg transition-colors shadow-sm flex items-center space-x-2"
                  >
                    <span>Cargar más empleos</span>
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}

        </div>
      </main>

      {/* FOOTER */}
      <footer className="bg-navy border-t border-slate-800 text-slate-400 text-xs py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-3">
          <p className="font-semibold text-slate-300">TrabajoCR 🇨🇷</p>
          <p>Datos provistos por Remotive, RemoteOK, Jooble, The Muse, We Work Remotely, Arbeitnow, Getonbrd, RemotoJob y Findjobit.</p>
          <p className="text-slate-500">
            Desarrollado de forma local en tu navegador · El almacenamiento es local (localStorage) y las claves API nunca se envían a servidores externos.
          </p>
          <p className="text-slate-650 pt-2 border-t border-slate-800 max-w-xs mx-auto">
            Hecho en 🇨🇷
          </p>
        </div>
      </footer>

      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
        <SettingsModal 
          currentSettings={settings}
          onClose={() => setIsSettingsOpen(false)}
          onSave={saveSettings}
        />
      )}
    </>
  );
}

// --- SETTINGS MODAL SUBCOMPONENT ---
interface SettingsModalProps {
  currentSettings: AppSettings;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
}

function SettingsModal({ currentSettings, onClose, onSave }: SettingsModalProps) {
  const [joobleKey, setJoobleKey] = useState(currentSettings.joobleKey);
  const [groqKey, setGroqKey] = useState(currentSettings.groqKey);
  const [anthropicKey, setAnthropicKey] = useState(currentSettings.anthropicKey);
  const [aiProvider, setAiProvider] = useState<"groq" | "anthropic">(currentSettings.aiProvider);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Modal Header */}
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-bold text-slate-800 flex items-center space-x-2">
            <Settings className="w-5 h-5 text-slate-500" />
            <span>Configuración de APIs</span>
          </h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            Ingresá tus claves de API correspondientes para habilitar las características premium del buscador. Se guardan localmente en tu navegador.
          </p>

          {/* Jooble Key */}
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-600">Jooble API Key</label>
            <input 
              type="password" 
              value={joobleKey}
              onChange={(e) => setJoobleKey(e.target.value)}
              placeholder="Tu Jooble API Key..." 
              className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-slate-700"
            />
            <span className="block text-[10px] text-slate-400">
              Obtenible gratis en{" "}
              <a 
                href="https://jooble.org/api/about" 
                target="_blank" 
                rel="noreferrer"
                className="text-primary hover:underline font-semibold"
              >
                jooble.org/api/about
              </a>
              . Habilita búsquedas en Costa Rica.
            </span>
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-3">
            <h4 className="text-xs font-bold text-slate-700 flex items-center space-x-1">
              <Cpu className="w-3.5 h-3.5" />
              <span>Proveedor de Inteligencia Artificial (CV Matcher)</span>
            </h4>
            
            {/* AI Provider Dropdown */}
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-600">Proveedor</label>
              <select 
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as "groq" | "anthropic")}
                className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-700 bg-white"
              >
                <option value="groq">Groq (Llama 3.3) — Rápido, seguro y gratuito</option>
                <option value="anthropic">Anthropic (Claude 3.5 Sonnet) — Máxima calidad</option>
              </select>
            </div>

            {/* Groq Key */}
            {aiProvider === "groq" ? (
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-600">Groq API Key</label>
                <input 
                  type="password" 
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder="gsk_..." 
                  className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-slate-700"
                />
                <span className="block text-[10px] text-slate-400">
                  Obtenible gratis en{" "}
                  <a 
                    href="https://console.groq.com" 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-primary hover:underline font-semibold"
                  >
                    console.groq.com
                  </a>
                  .
                </span>
              </div>
            ) : (
              /* Anthropic Key */
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-600">Anthropic API Key</label>
                <input 
                  type="password" 
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..." 
                  className="w-full p-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-slate-700"
                />
                <span className="block text-[10px] text-slate-400">
                  Clave estándar de Claude API. Se ejecuta en el servidor de forma segura.
                </span>
              </div>
            )}
          </div>

          <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <p className="text-[10px] text-slate-500 leading-relaxed">
              <strong>🔒 Seguridad local</strong>: Tu clave se guarda solo en este navegador y se envía directamente a la API correspondiente sin intermediarios. Nunca viaja a ningún otro servidor externo.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex justify-end space-x-2">
          <button 
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold hover:bg-slate-100 transition-colors text-slate-700"
          >
            Cancelar
          </button>
          <button 
            onClick={() => onSave({ joobleKey, groqKey, anthropicKey, aiProvider })}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
          >
            Guardar Cambios
          </button>
        </div>
      </div>
    </div>
  );
}
