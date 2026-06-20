import { NextResponse } from "next/server";

// Interfaces
interface NormalizedJob {
  id: string;
  title: string;
  company: string;
  source: "remotive" | "remoteok" | "jooble" | "muse" | "remotejobs";
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
}

interface FetchStatus {
  status: "loaded" | "failed" | "not_configured";
  msg: string;
}

// Helpers for normalizations
function truncateString(str: string, num: number): string {
  if (!str) return "";
  if (str.length <= num) return str;
  return str.slice(0, num) + "...";
}

function computeRelevance(job: Partial<NormalizedJob>): "high" | "medium" | "low" {
  const desc = (job.description || "").toLowerCase();
  const title = (job.title || "").toLowerCase();
  const loc = (job.location || "").toLowerCase();
  const tags = (job.tags || []).map(t => t.toLowerCase());

  const keywords = ["costa rica", "cr", "latam", "latin america", "centroamerica", "centroamérica", "español", "spanish speaker", "spanish"];
  
  const isHighMatch = keywords.some(k => {
    if (k === "cr") {
      const crRegex = /\bcr\b/;
      return crRegex.test(desc) || crRegex.test(title) || crRegex.test(loc) || tags.includes("cr");
    }
    return desc.includes(k) || title.includes(k) || loc.includes(k) || tags.includes(k);
  });

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

  if (isHighMatch || isLowSalaryUSD) {
    return "high";
  }

  const locClean = loc.trim();
  const isWorldwide = locClean === "" || locClean === "worldwide" || locClean.includes("anywhere") || locClean.includes("worldwide") || locClean.includes("remote - worldwide");
  if (isWorldwide || job.remote) {
    // low if timezone/country restricts explicitly to incompatible regions
    const hasTimezoneBlock = loc.includes("us only") || loc.includes("eu only") || loc.includes("usa only") || loc.includes("europe") || loc.includes("united states") || loc.includes("canada") || loc.includes("uk only") || loc.includes("germany") || loc.includes("timezone: est") || loc.includes("timezone: pst");
    if (hasTimezoneBlock) {
      return "low";
    }
    return "medium";
  }

  return "low";
}

function categorizeJob(job: Partial<NormalizedJob>): string {
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

function classifyJobType(job: Partial<NormalizedJob>): string {
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

// API Handlers
async function fetchRemotive(): Promise<NormalizedJob[]> {
  const searchTerms = ["latam", "latin+america", "costa+rica", "worldwide"];
  const jobs: NormalizedJob[] = [];
  
  // Fetch API search terms in parallel
  const apiPromises = searchTerms.map(term =>
    fetch(`https://remotive.com/api/remote-jobs?limit=100&search=${term}`, { signal: AbortSignal.timeout(10000) })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch(e => {
        console.warn(`Remotive API search for ${term} failed:`, e);
        return null;
      })
  );

  // Fetch RSS Feed in parallel
  const rssPromise = fetch("https://api.rss2json.com/v1/api.json?rss_url=https://remotive.com/remote-jobs/feed", { signal: AbortSignal.timeout(10000) })
    .then(async r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(e => {
      console.warn("Remotive RSS Feed failed:", e);
      return null;
    });

  const [apiResults, rssResult] = await Promise.all([
    Promise.all(apiPromises),
    rssPromise
  ]);

  // Parse APIs
  apiResults.forEach(res => {
    if (res && Array.isArray(res.jobs)) {
      res.jobs.forEach((item: any) => {
        const normalized: Partial<NormalizedJob> = {
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
        jobs.push(normalized as NormalizedJob);
      });
    }
  });

  // Parse RSS
  if (rssResult && Array.isArray(rssResult.items)) {
    rssResult.items.forEach((item: any, index: number) => {
      const idHash = item.link ? item.link.replace(/[^a-zA-Z0-9]/g, "").substring(0, 30) : `rss-${index}`;
      const normalized: Partial<NormalizedJob> = {
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
      jobs.push(normalized as NormalizedJob);
    });
  }

  if (jobs.length === 0) {
    throw new Error("No se pudo cargar ninguna de las búsquedas o feeds de Remotive");
  }

  return jobs;
}

async function fetchRemoteOK(): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  
  const res = await fetch("https://remoteok.com/api", {
    headers: {
      "User-Agent": "trabajocr/1.0"
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Formato inválido de RemoteOK");
  }

  // Skip legal disclaimer (first element)
  const items = data.slice(1);
  const matchFilters = ["latam", "latin america", "costa rica", "worldwide", "anywhere", "spanish", "english", "remote"];

  items.forEach((item: any) => {
    if (!item.position) return;
    
    const tags = (item.tags || []).map((t: string) => t.toLowerCase());
    const isRelevant = tags.some((t: string) => matchFilters.includes(t));
    if (!isRelevant) return; // filter client-side representation in server

    const normalized: Partial<NormalizedJob> = {
      id: `remoteok-${item.id}`,
      title: item.position,
      company: item.company,
      source: "remoteok",
      sourceLabel: "RemoteOK",
      date: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
      url: item.url,
      description: truncateString(item.description || "", 1000),
      tags: tags,
      location: "Remote",
      salary: item.salary_min && item.salary_max ? `$${(item.salary_min/1000).toFixed(0)}k - $${(item.salary_max/1000).toFixed(0)}k/año` : null,
      remote: true
    };
    normalized.crRelevance = computeRelevance(normalized);
    normalized.category = categorizeJob(normalized);
    normalized.jobType = classifyJobType(normalized);
    jobs.push(normalized as NormalizedJob);
  });

  return jobs;
}

async function fetchJooble(key: string): Promise<NormalizedJob[]> {
  if (!key) return [];
  const jobs: NormalizedJob[] = [];

  const queries = [
    { keywords: "remoto", location: "Costa Rica", page: 1 },
    { keywords: "remote", location: "Costa Rica", page: 1 }
  ];

  const fetchPromises = queries.map(body => 
    fetch(`https://jooble.org/api/${key}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000)
    })
    .then(async r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(e => {
      console.warn("Jooble search query failed:", e);
      return null;
    })
  );

  const results = await Promise.all(fetchPromises);
  
  results.forEach(data => {
    if (data && Array.isArray(data.jobs)) {
      data.jobs.forEach((item: any, index: number) => {
        const idHash = item.link ? item.link.replace(/[^a-zA-Z0-9]/g, "").substring(0, 30) : `jooble-${index}`;
        const normalized: Partial<NormalizedJob> = {
          id: `jooble-${idHash}`,
          title: item.title,
          company: item.company || "Desconocida",
          source: "jooble",
          sourceLabel: "Jooble",
          date: item.updated ? new Date(item.updated).toISOString() : new Date().toISOString(),
          url: item.link,
          description: truncateString(item.snippet || "", 1000),
          tags: ["remote", "costa rica"],
          location: item.location || "Costa Rica",
          salary: item.salary || null,
          remote: (item.location || "").toLowerCase().includes("remot") || item.title.toLowerCase().includes("remot")
        };
        normalized.crRelevance = computeRelevance(normalized);
        normalized.category = categorizeJob(normalized);
        normalized.jobType = classifyJobType(normalized);
        jobs.push(normalized as NormalizedJob);
      });
    }
  });

  if (jobs.length === 0) {
    throw new Error("No se pudieron cargar ofertas de Jooble");
  }

  return jobs;
}

async function fetchMuse(): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  const pages = [0, 1];

  const fetchPromises = pages.map(page =>
    fetch(`https://www.themuse.com/api/public/jobs?page=${page}&descending=true`, { signal: AbortSignal.timeout(10000) })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch(e => {
        console.warn("The Muse API failed on page " + page, e);
        return null;
      })
  );

  const results = await Promise.all(fetchPromises);

  results.forEach(data => {
    if (data && Array.isArray(data.results)) {
      data.results.forEach((item: any) => {
        const locs = item.locations || [];
        const isRemote = locs.some((l: any) => l.name.toLowerCase().includes("remote") || l.name.toLowerCase().includes("flexible"));
        const hasCompanySize = !!item.company_size;

        if (!isRemote && !hasCompanySize) return;

        const normalized: Partial<NormalizedJob> = {
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
        jobs.push(normalized as NormalizedJob);
      });
    }
  });

  if (jobs.length === 0) {
    throw new Error("No se pudieron cargar ofertas de The Muse");
  }

  return jobs;
}

async function fetchRemoteJobsLat(): Promise<NormalizedJob[]> {
  const jobs: NormalizedJob[] = [];
  
  const res = await fetch("https://api.rss2json.com/v1/api.json?rss_url=https://remotejobs.lat/feed/", { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();
  if (data && Array.isArray(data.items)) {
    data.items.forEach((item: any, index: number) => {
      const idHash = item.link ? item.link.replace(/[^a-zA-Z0-9]/g, "").substring(0, 30) : `rjlat-${index}`;
      const normalized: Partial<NormalizedJob> = {
        id: `remotejobs-${idHash}`,
        title: item.title,
        company: item.author || "remotejobs.lat",
        source: "remotejobs",
        sourceLabel: "remotejobs.lat",
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
      jobs.push(normalized as NormalizedJob);
    });
  } else {
    throw new Error("Formato inválido");
  }

  return jobs;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const joobleKey = searchParams.get("joobleKey") || "";

  // Set initial status to loading/not configured
  const status: Record<string, FetchStatus> = {
    remotive: { status: "failed", msg: "Cargando..." },
    remoteok: { status: "failed", msg: "Cargando..." },
    jooble: joobleKey ? { status: "failed", msg: "Cargando..." } : { status: "not_configured", msg: "Falta API Key" },
    muse: { status: "failed", msg: "Cargando..." },
    remotejobs: { status: "failed", msg: "Cargando..." }
  };

  const promises: [
    Promise<NormalizedJob[]>,
    Promise<NormalizedJob[]>,
    Promise<NormalizedJob[]>,
    Promise<NormalizedJob[]>,
    Promise<NormalizedJob[]>
  ] = [
    fetchRemotive().then(jobs => {
      status.remotive = { status: "loaded", msg: "Cargado" };
      return jobs;
    }).catch(e => {
      status.remotive = { status: "failed", msg: e.message || "Error" };
      return [];
    }),
    fetchRemoteOK().then(jobs => {
      status.remoteok = { status: "loaded", msg: "Cargado" };
      return jobs;
    }).catch(e => {
      status.remoteok = { status: "failed", msg: e.message || "Error" };
      return [];
    }),
    (joobleKey ? fetchJooble(joobleKey) : Promise.resolve([])).then(jobs => {
      if (joobleKey) {
        status.jooble = { status: "loaded", msg: "Cargado" };
      }
      return jobs;
    }).catch(e => {
      status.jooble = { status: "failed", msg: e.message || "Error" };
      return [];
    }),
    fetchMuse().then(jobs => {
      status.muse = { status: "loaded", msg: "Cargado" };
      return jobs;
    }).catch(e => {
      status.muse = { status: "failed", msg: e.message || "Error" };
      return [];
    }),
    fetchRemoteJobsLat().then(jobs => {
      status.remotejobs = { status: "loaded", msg: "Cargado" };
      return jobs;
    }).catch(e => {
      status.remotejobs = { status: "failed", msg: e.message || "Error" };
      return [];
    })
  ];

  const results = await Promise.all(promises);
  let combinedJobs: NormalizedJob[] = [];
  results.forEach(res => {
    combinedJobs = combinedJobs.concat(res);
  });

  // Filtrar únicamente los trabajos que geográficamente no son aplicables desde Costa Rica
  const filteredJobs = combinedJobs.filter(job => {
    // Descartar trabajos de relevancia baja (con restricciones geográficas que excluyen explícitamente a CR/LATAM)
    if (job.crRelevance === "low") {
      return false;
    }
    return true;
  });

  // Deduplicar sobre la lista filtrada
  const deduplicatedMap = new Map<string, NormalizedJob>();
  filteredJobs.forEach(job => {
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

  const jobsList = Array.from(deduplicatedMap.values());
  
  // Sort by date descending initially
  jobsList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return NextResponse.json({
    jobs: jobsList,
    status: status
  });
}
