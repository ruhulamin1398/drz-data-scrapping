import { NextRequest, NextResponse } from "next/server";

// Force dynamic — this route must never be cached itself.
export const dynamic = "force-dynamic";

type Probe = {
  n: number;
  status: number;
  statusText: string;
  ms: number;
  bytes: number;
  finalUrl: string;
  headers: Record<string, string>;
  at: string;
};

function parseCacheControl(raw: string) {
  const directives: Record<string, string | true> = {};
  for (const part of raw.split(",")) {
    const [k, ...rest] = part.trim().split("=");
    const key = k.trim().toLowerCase();
    if (!key) continue;
    const val = rest.join("=").trim().replace(/^"|"$/g, "");
    directives[key] = val === "" ? true : val;
  }
  const num = (v: string | true | undefined) => {
    if (typeof v !== "string") return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    directives,
    maxAge: num(directives["max-age"]),
    sMaxage: num(directives["s-maxage"]),
    swr: num(directives["stale-while-revalidate"]),
    noStore: "no-store" in directives,
    noCache: "no-cache" in directives,
    isPrivate: "private" in directives,
    isPublic: "public" in directives,
    immutable: "immutable" in directives,
    mustRevalidate: "must-revalidate" in directives,
  };
}

function humanSecs(s: number | null): string {
  if (s === null) return "—";
  if (s < 0) return `${s}s (expired ${Math.abs(s)}s ago)`;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s < 31536000) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  const years = Math.floor(s / 31536000);
  return `${years}y`;
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  if (["localhost", "::1"].includes(h)) return true;
  if (h.endsWith(".local")) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

async function probe(url: string, n: number): Promise<Probe> {
  const at = new Date().toISOString();
  const t0 = Date.now();
  const res = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 (cache-inspector)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  const buf = await res.arrayBuffer().catch(() => null);
  const ms = Date.now() - t0;
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return {
    n,
    status: res.status,
    statusText: res.statusText,
    ms,
    bytes: buf?.byteLength ?? 0,
    finalUrl: res.url || url,
    headers,
    at,
  };
}

function normCacheWord(v: string | undefined): string | null {
  if (!v) return null;
  const u = v.toUpperCase();
  if (u.includes("HIT")) return "HIT";
  if (u.includes("MISS")) return "MISS";
  if (u.includes("STALE") || u.includes("UPDATING") || u.includes("EXPIRED")) return "STALE";
  if (u.includes("REVALIDATED")) return "REVALIDATED";
  if (u.includes("BYPASS") || u.includes("DYNAMIC")) return "BYPASS";
  return null;
}

// GET /api/cache-inspect?url=https://...
export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("url")?.trim() ?? "";
    if (!raw) return NextResponse.json({ error: "missing ?url=" }, { status: 400 });
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return NextResponse.json({ error: "invalid URL" }, { status: 400 });
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return NextResponse.json({ error: "only http(s) URLs allowed" }, { status: 400 });
    }
    if (isBlockedHost(u.hostname)) {
      return NextResponse.json({ error: "private/local hosts are blocked" }, { status: 400 });
    }

    const p1 = await probe(u.toString(), 1);
    await new Promise((r) => setTimeout(r, 800));
    const p2 = await probe(u.toString(), 2);

    // Use the second (settled) pass for the verdict.
    const h = p2.headers;
    const ccRaw = h["cache-control"] ?? "";
    const cc = parseCacheControl(ccRaw);
    const ageSec = h["age"] !== undefined ? parseInt(h["age"], 10) : NaN;
    const hasAge = Number.isFinite(ageSec);

    const nextCache = h["x-nextjs-cache"];
    const vercelCache = h["x-vercel-cache"];
    const cfCache = h["cf-cache-status"];
    const xCache = h["x-cache"];
    const rawSignal = nextCache ?? vercelCache ?? cfCache ?? xCache ?? null;
    let cache = normCacheWord(rawSignal ?? undefined);

    if (!cache) {
      if (cc.noStore || (cc.noCache && !cc.swr)) cache = "BYPASS";
      else if (cc.isPrivate && (cc.noCache || cc.noStore)) cache = "BYPASS";
      else if (hasAge && ageSec > 0) cache = "HIT";
      else cache = "UNKNOWN";
    }

    let render: "HOT" | "COLD" | "UNKNOWN" = "UNKNOWN";
    if (cache === "HIT" || cache === "STALE") render = "HOT";
    else if (cache === "MISS" || cache === "REVALIDATED") render = "COLD";
    else if (cache === "BYPASS") render = "COLD";

    const freshTtl = cc.sMaxage ?? cc.maxAge ?? null;
    const probedAt = p2.at;
    const T = new Date(probedAt).getTime();
    const remainingFresh = freshTtl !== null && hasAge ? freshTtl - ageSec : null;
    const freshness = {
      cacheControl: ccRaw || null,
      sMaxage: cc.sMaxage,
      maxAge: cc.maxAge,
      staleWhileRevalidate: cc.swr,
      staleTime: h["x-nextjs-stale-time"] ?? null,
      prerender: h["x-nextjs-prerender"] ?? null,
      age: hasAge ? ageSec : null,
      date: h["date"] ?? null,
      expires: h["expires"] ?? null,
      etag: h["etag"] ?? null,
      lastModified: h["last-modified"] ?? null,
      freshTtlHuman: humanSecs(freshTtl),
      freshUntil: remainingFresh !== null ? new Date(T + remainingFresh * 1000).toISOString() : null,
      remainingFreshHuman: remainingFresh !== null ? humanSecs(remainingFresh) : null,
      staleUntil:
        remainingFresh !== null && cc.swr !== null
          ? new Date(T + (remainingFresh + cc.swr) * 1000).toISOString()
          : null,
      ageUnknownNote:
        freshTtl !== null && !hasAge
          ? "Origin sends no Age header, so exact cache age is unknown — HIT still proves a hot (cached) render."
          : null,
    };

    const ttfbDelta = p1.ms - p2.ms;
    let summary = "";
    if (cache === "HIT") {
      summary =
        `CACHE HIT — hot render served from the Next.js ISR/prerender cache, no server render happened. ` +
        (freshTtl !== null ? `Fresh window ${humanSecs(freshTtl)}${cc.sMaxage !== null ? " (s-maxage)" : " (max-age)"}. ` : "") +
        (h["x-nextjs-stale-time"] ? `Client router stale-time ${h["x-nextjs-stale-time"]}s. ` : "") +
        (ttfbDelta > 150 ? `Second pass was ${ttfbDelta}ms faster, confirming hot.` : "Both passes HIT — stably cached.");
    } else if (cache === "MISS") {
      summary =
        "CACHE MISS — cold render: the server rendered this page fresh (slower). This response is now cached, so inspect again to see HIT.";
    } else if (cache === "STALE") {
      summary =
        "STALE — hot render of the old copy while Next.js revalidates in the background (stale-while-revalidate). Next visit should be fresh HIT.";
    } else if (cache === "REVALIDATED") {
      summary = "REVALIDATED — the cache entry was regenerated on this request (cold this time, HIT next time).";
    } else if (cache === "BYPASS") {
      summary = "DYNAMIC / BYPASS — this route is never cached (private / no-store). Every visit is a cold render.";
    } else {
      summary =
        "UNKNOWN — no cache signal headers found. The page may be dynamic, behind a proxy that strips headers, or non-Next.js.";
    }

    return NextResponse.json({
      ok: true,
      input: raw,
      finalUrl: p2.finalUrl,
      probedAt,
      verdict: {
        cache,
        render,
        signal: rawSignal,
        signalSource: nextCache
          ? "x-nextjs-cache"
          : vercelCache
            ? "x-vercel-cache"
            : cfCache
              ? "cf-cache-status"
              : xCache
                ? "x-cache"
                : hasAge
                  ? "age"
                  : "cache-control",
        summary,
      },
      server: {
        server: h["server"] ?? null,
        poweredBy: h["x-powered-by"] ?? null,
        contentType: h["content-type"] ?? null,
        vary: h["vary"] ?? null,
      },
      probes: [
        { ...p1, headers: undefined },
        { ...p2, headers: undefined },
      ],
      probeHeaders: p2.headers,
      pass1Cache: p1.headers["x-nextjs-cache"] ?? p1.headers["x-vercel-cache"] ?? p1.headers["cf-cache-status"] ?? null,
      timing: { pass1Ms: p1.ms, pass2Ms: p2.ms, deltaMs: p2.ms - p1.ms, bytes: p2.bytes },
      freshness,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
