import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cvText, provider, apiKey } = body;

    if (!cvText || !provider || !apiKey) {
      return NextResponse.json({ error: "Faltan parámetros obligatorios (cvText, provider o apiKey)" }, { status: 400 });
    }

    if (provider === "groq") {
      return await callGroq(cvText, apiKey);
    } else if (provider === "anthropic") {
      return await callAnthropic(cvText, apiKey);
    } else {
      return NextResponse.json({ error: "Proveedor no soportado" }, { status: 400 });
    }
  } catch (err: any) {
    console.error("Match API internal error:", err);
    return NextResponse.json({ error: err.message || "Error interno del servidor" }, { status: 500 });
  }
}

async function callGroq(cvText: string, apiKey: string) {
  const systemPrompt = `You are an expert CV Parser and Candidate Profile Extractor.
Analyze the provided CV text and extract a structured JSON profile representing the candidate.
Follow these extraction rules strictly:
1. "skills": An array of technical/hard skills, programming languages, frameworks, databases, and key tools mentioned in the CV (e.g. ["react", "typescript", "node.js", "sql"]). Normalize everything to lowercase.
2. "roles": An array of matching professional roles or job titles matching their experience (e.g. ["frontend developer", "fullstack engineer", "customer support agent", "qa tester"]). Normalize to lowercase.
3. "languages": A dictionary mapping language codes ("es", "en", "pt") to their level. The level MUST be one of: "native", "advanced", "intermediate", "basic", "none". If a language is not mentioned, classify it as "none" unless Spanish ("es") can be inferred from the CV language (e.g., if the CV is written in Spanish, "es" is likely "native" or "advanced").
4. "level": The overall experience/seniority level. MUST be exactly one of: "junior", "mid", "senior", "lead". Base this on their years of experience and role titles.

Return ONLY valid JSON matching this exact structure:
{
  "profile": {
    "skills": ["skill1", "skill2"],
    "roles": ["role1", "role2"],
    "languages": {
      "es": "native|advanced|intermediate|basic|none",
      "en": "native|advanced|intermediate|basic|none",
      "pt": "native|advanced|intermediate|basic|none"
    },
    "level": "junior|mid|senior|lead"
  }
}`;

  const userPrompt = `CV Text:\n${cvText}`;

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
        const profile = parseAIResponse(rawText);
        return NextResponse.json({ profile });
      } catch (error: any) {
        lastError = error;
        console.warn(`[Groq Rotator] Key ${i + 1} failed:`, error.message);
        
        if (error.message.includes("429") || error.message.includes("503")) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
  }

  throw new Error(`All Groq API keys exhausted. Last error: ${lastError?.message}`);
}

async function callAnthropic(cvText: string, apiKey: string) {
  const systemPrompt = `You are an expert CV Parser and Candidate Profile Extractor.
Analyze the provided CV text and extract a structured JSON profile representing the candidate.
Follow these extraction rules strictly:
1. "skills": An array of technical/hard skills, programming languages, frameworks, databases, and key tools mentioned in the CV (e.g. ["react", "typescript", "node.js", "sql"]). Normalize everything to lowercase.
2. "roles": An array of matching professional roles or job titles matching their experience (e.g. ["frontend developer", "fullstack engineer", "customer support agent", "qa tester"]). Normalize to lowercase.
3. "languages": A dictionary mapping language codes ("es", "en", "pt") to their level. The level MUST be one of: "native", "advanced", "intermediate", "basic", "none". If a language is not mentioned, classify it as "none" unless Spanish ("es") can be inferred from the CV language (e.g., if the CV is written in Spanish, "es" is likely "native" or "advanced").
4. "level": The overall experience/seniority level. MUST be exactly one of: "junior", "mid", "senior", "lead". Base this on their years of experience and role titles.

Return ONLY valid JSON matching this exact structure:
{
  "profile": {
    "skills": ["skill1", "skill2"],
    "roles": ["role1", "role2"],
    "languages": {
      "es": "native|advanced|intermediate|basic|none",
      "en": "native|advanced|intermediate|basic|none",
      "pt": "native|advanced|intermediate|basic|none"
    },
    "level": "junior|mid|senior|lead"
  }
}`;

  const userPrompt = `CV Text:\n${cvText}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1500,
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
  const profile = parseAIResponse(rawText);
  return NextResponse.json({ profile });
}

function parseAIResponse(text: string): any {
  let clean = text.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }
  
  const parsed = JSON.parse(clean);
  if (parsed.profile) {
    return parsed.profile;
  }
  return parsed;
}
