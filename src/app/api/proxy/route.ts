import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    // Add a timeout to the fetch call (e.g., 8 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8"
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return new Response(`Failed to fetch: ${res.statusText}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "text/plain";
    const body = await res.text();

    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Timeout or network error" }, { status: 500 });
  }
}
