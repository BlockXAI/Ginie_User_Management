import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const API_BASE = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "https://evi-user-apis-production.up.railway.app").replace(/\/+$/, "");

async function handler(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  // Filter out empty segments and normalize path to prevent double slashes
  const cleanSegs = segs.filter((s) => s && s.trim());
  const path = "/" + cleanSegs.join("/");
  const url = `${API_BASE}${path}${request.nextUrl.search}`;

  // Debug log for troubleshooting
  console.log(JSON.stringify({ level: "debug", msg: "proxy.request", path, url: url.replace(API_BASE, "[API_BASE]"), method: request.method }));

  const headers: Record<string, string> = {
    "Content-Type": request.headers.get("content-type") || "application/json",
    Accept: request.headers.get("accept") || "application/json",
  };

  // Forward cookies from browser to backend
  const cookieHeaderFromReq = request.headers.get("cookie") || "";
  const cookieHeaderFromParsed = request.cookies
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const cookieHeader = cookieHeaderFromReq || cookieHeaderFromParsed;
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  // Forward CSRF token if present
  const csrf = request.headers.get("x-csrf-token");
  if (csrf) headers["x-csrf-token"] = csrf;

  // Forward origin and proxy hints
  const origin = request.headers.get("origin") || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  if (origin) headers["origin"] = origin;
  const xfProto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  const xfHost = request.headers.get("x-forwarded-host") || request.nextUrl.host;
  const xfFor = request.headers.get("x-forwarded-for") || "";
  if (xfProto) headers["x-forwarded-proto"] = xfProto;
  if (xfHost) headers["x-forwarded-host"] = xfHost;
  if (xfFor) headers["x-forwarded-for"] = xfFor;

  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.text();
  }

  const timeoutMs = 60000;

  let res: Response | undefined;
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(url, {
        method: request.method,
        headers,
        body,
        credentials: "include",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      lastErr = undefined;
      break;
    } catch (e: any) {
      clearTimeout(timeoutId);
      lastErr = e;
      if (e?.name === "AbortError") break;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  if (!res) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "upstream_unreachable",
          message: String(lastErr?.cause?.code || lastErr?.code || lastErr?.message || "fetch failed").slice(0, 120),
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();

  // Forward upstream headers (except those we rewrite)
  res.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (key === "set-cookie") return;
    if (key === "content-length") return;
    responseHeaders.set(k, v);
  });

  // Forward Set-Cookie headers from backend to browser, rewrite for current origin
  const isHttps = request.nextUrl.protocol === "https:";
  const setCookies = res.headers.getSetCookie?.() || [];
  if (setCookies.length) {
    for (let sc of setCookies) {
      try {
        // Remove Domain attribute so cookie is scoped to current host
        sc = sc.replace(/;\s*Domain=[^;]+/gi, "");
        // In dev (http), drop Secure and avoid SameSite=None
        if (!isHttps) {
          sc = sc.replace(/;\s*Secure/gi, "");
          sc = sc.replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
        }
        responseHeaders.append("Set-Cookie", sc);
      } catch {
        responseHeaders.append("Set-Cookie", sc);
      }
    }
  } else {
    // Fallback for environments without getSetCookie()
    const raw = res.headers.get("set-cookie");
    if (raw) {
      const parts = raw.split(/,(?=[^;]+?=)/g);
      for (let sc of parts) {
        try {
          sc = sc.replace(/;\s*Domain=[^;]+/gi, "");
          if (!isHttps) {
            sc = sc.replace(/;\s*Secure/gi, "");
            sc = sc.replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
          }
          responseHeaders.append("Set-Cookie", sc);
        } catch {
          responseHeaders.append("Set-Cookie", sc);
        }
      }
    }
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType) responseHeaders.set("Content-Type", contentType);

  const data = await res.arrayBuffer();
  return new NextResponse(data, {
    status: res.status,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
