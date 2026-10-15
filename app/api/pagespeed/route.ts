import { NextRequest, NextResponse } from "next/server";

// Same data source pagespeed.web.dev uses: PSI v5 (Lighthouse lab + CrUX field).
// Runs can take 30-60s, so allow a long serverless window.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  if (["localhost", "::1"].includes(h)) return true;
  if (h.endsWith(".local")) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

type LabMetric = { id: string; title: string; display: string; value: number | null; unit: string | null; score: number | null };

function pickAudit(audits: Record<string, any>, id: string, fallbackTitle: string): LabMetric {
  const a = audits?.[id];
  return {
    id,
    title: a?.title ?? fallbackTitle,
    display: a?.displayValue ?? "—",
    value: typeof a?.numericValue === "number" ? a.numericValue : null,
    unit: a?.numericUnit ?? null,
    score: typeof a?.score === "number" ? a.score : null,
  };
}

function pickField(metrics: Record<string, any> | undefined, key: string) {
  const m = metrics?.[key];
  if (!m) return null;
  return { percentile: m.percentile ?? null, category: m.category ?? null };
}

// GET /api/pagespeed?url=https://...&strategy=mobile|desktop
export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("url")?.trim() ?? "";
    const strategy = req.nextUrl.searchParams.get("strategy") === "desktop" ? "desktop" : "mobile";
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

    const key = process.env.PAGESPEED_API_KEY?.trim();
    // Overridable for local testing (e.g. serve a canned PSI JSON file).
    const base =
      process.env.PAGESPEED_API_URL || "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
    const psi =
      `${base}` +
      `?url=${encodeURIComponent(u.toString())}&strategy=${strategy}&category=performance` +
      (key ? `&key=${encodeURIComponent(key)}` : "");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);
    let res: Response;
    try {
      res = await fetch(psi, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error && e.name === "AbortError" ? "PageSpeed timed out (>55s) — retry, repeat runs are faster (PSI caches)" : `PageSpeed request failed: ${e instanceof Error ? e.message : String(e)}` },
        { status: 504 }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      const needsKey = res.status === 429 || res.status === 403;
      return NextResponse.json(
        {
          error: `PageSpeed API ${res.status}: ${t.slice(0, 300)}`,
          needsKey,
          keyHint: needsKey
            ? "Anonymous PageSpeed quota is exhausted. Free fix: enable 'PageSpeed Insights API' in Google Cloud Console → create an API key → add PAGESPEED_API_KEY=<key> to .env.local and restart."
            : undefined,
        },
        { status: 502 }
      );
    }
    const j = await res.json().catch(() => null);
    const lh = j?.lighthouseResult;
    if (!lh) return NextResponse.json({ error: "PageSpeed returned no lighthouseResult" }, { status: 502 });

    const audits = lh.audits ?? {};
    const scoreRaw = lh?.categories?.performance?.score;
    const lab = {
      fcp: pickAudit(audits, "first-contentful-paint", "First Contentful Paint"),
      lcp: pickAudit(audits, "largest-contentful-paint", "Largest Contentful Paint"),
      tbt: pickAudit(audits, "total-blocking-time", "Total Blocking Time"),
      cls: pickAudit(audits, "cumulative-layout-shift", "Cumulative Layout Shift"),
      si: pickAudit(audits, "speed-index", "Speed Index"),
      tti: pickAudit(audits, "interactive", "Time to Interactive"),
      ttfb: pickAudit(audits, "server-response-time", "Server Response Time"),
    };
    const fieldMetrics = j?.loadingExperience?.metrics;
    const field = {
      fcp: pickField(fieldMetrics, "FIRST_CONTENTFUL_PAINT_MS"),
      lcp: pickField(fieldMetrics, "LARGEST_CONTENTFUL_PAINT_MS"),
      inp: pickField(fieldMetrics, "INTERACTION_TO_NEXT_PAINT"),
      cls: pickField(fieldMetrics, "CUMULATIVE_LAYOUT_SHIFT"),
      overallCategory: j?.loadingExperience?.overall_category ?? null,
    };
    const originMetrics = j?.originLoadingExperience?.metrics;
    const originField = originMetrics
      ? {
          fcp: pickField(originMetrics, "FIRST_CONTENTFUL_PAINT_MS"),
          lcp: pickField(originMetrics, "LARGEST_CONTENTFUL_PAINT_MS"),
          inp: pickField(originMetrics, "INTERACTION_TO_NEXT_PAINT"),
          cls: pickField(originMetrics, "CUMULATIVE_LAYOUT_SHIFT"),
          overallCategory: j?.originLoadingExperience?.overall_category ?? null,
        }
      : null;

    return NextResponse.json({
      ok: true,
      input: raw,
      finalUrl: lh?.finalUrl ?? raw,
      strategy,
      score: typeof scoreRaw === "number" ? Math.round(scoreRaw * 100) : null,
      fetchTime: lh?.fetchTime ?? j?.analysisUTCTimestamp ?? null,
      cruxAvailable: !!fieldMetrics,
      lab,
      field,
      originField,
      reportUrl: `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(u.toString())}&form_factor=${strategy}`,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
