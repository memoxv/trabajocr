import { NextResponse } from "next/server";

interface MatchResult {
  id: string;
  score: number;
  reason: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cvText, jobs, provider, apiKey } = body;

    if (!cvText || !jobs || !Array.isArray(jobs) || !provider || !apiKey) {
      return NextResponse.json({ error: "Faltan parámetros obligatorios" }, { status: 400 });
    }

    if (provider === "groq") {
      return await callGroq(cvText, jobs, apiKey);
    } else if (provider === "anthropic") {
      return await callAnthropic(cvText, jobs, apiKey);
    } else {
      return NextResponse.json({ error: "Proveedor no soportado" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("Match API internal error:", err);
    return NextResponse.json({ error: err.message || "Error interno del servidor" }, { status: 500 });
  }
}

async function callGroq(cvText: string, jobs: any[], apiKey: string) {
  const systemPrompt = `You are a job matching assistant for Costa Rica and LATAM. Given a CV and a list of jobs, analyze compatibility considering: technical skills match, language requirements, timezone compatibility with Costa Rica (UTC-6), salary expectations for CR market, and experience level. Return ONLY valid JSON containing a single array of objects under a key named "results", no markdown, no explanation.

JSON Format:
{
  "results": [
    {
      "id": "job-id-here",
      "score": 85,
      "reason": "Describe the reason briefly in Spanish (max 12 words)"
    }
  ]
}`;

  const userPrompt = `CV:\n${cvText}\n\nJobs (first 30 by date):\n${jobs
    .map(j => `ID:${j.id} | Title:${j.title} at Company:${j.company} | Tags:${j.tags.join(',')} | Details:${j.description.slice(0, 200)}`)
    .join('\n')}`;

  const groqKeys = apiKey
    .split(",")
    .map(k => k.trim().replace(/['"]/g, ""))
    .filter(k => k.length > 0);

  if (groqKeys.length === 0) {
    throw new Error("No Groq API keys provided");
  }

  let lastError: any = null;

  for (let cycle = 1; cycle <= 2; cycle++) {
    for (let i = 0; i < groqKeys.length; i++) {
      const currentKey = groqKeys[i];
      try {
        console.log(`[Groq Rotator] Cycle ${cycle} - Trying key ${i + 1}/${groqKeys.length}`);
        
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${currentKey}`
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            response_format: { type: "json_object" },
            temperature: 0.1,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Groq API HTTP ${response.status} - ${errText}`);
        }

        const data = await response.json();
        const rawText = data.choices[0]?.message?.content || "";
        const results = parseAIResponse(rawText);
        return NextResponse.json({ results });
      } catch (error: any) {
        lastError = error;
        console.warn(`[Groq Rotator] Key ${i + 1} failed:`, error.message);
        
        // Wait briefly if we get rate-limited (429) or service overload (503)
        if (error.message.includes("429") || error.message.includes("503")) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  throw new Error(`All Groq API keys exhausted. Last error: ${lastError?.message}`);
}

async function callAnthropic(cvText: string, jobs: any[], apiKey: string) {
  const systemPrompt = `You are a job matching assistant for Costa Rica and LATAM. Given a CV and a list of jobs, analyze compatibility considering: technical skills match, language requirements, timezone compatibility with Costa Rica (UTC-6), salary expectations for CR market, and experience level. Return ONLY valid JSON, no markdown, no explanation: [{"id": string, "score": 0-100, "reason": string (max 12 words in Spanish)}]`;

  const userPrompt = `CV:\n${cvText}\n\nJobs (first 30 by date):\n${jobs
    .map(j => `ID:${j.id} | Title:${j.title} at Company:${j.company} | Tags:${j.tags.join(',')} | Details:${j.description.slice(0, 200)}`)
    .join('\n')}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API returned HTTP ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawText = data.content[0]?.text || "";
  const results = parseAIResponse(rawText);
  return NextResponse.json({ results });
}

function parseAIResponse(text: string): MatchResult[] {
  let clean = text.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }
  
  const parsed = JSON.parse(clean);
  if (Array.isArray(parsed)) {
    return parsed;
  } else if (parsed.results && Array.isArray(parsed.results)) {
    return parsed.results;
  } else if (parsed.jobs && Array.isArray(parsed.jobs)) {
    return parsed.jobs;
  }
  throw new Error("Formato de JSON devuelto por la IA no reconocido");
}
