import { NextRequest, NextResponse } from "next/server";

// Minimal Gemini client via fetch to avoid extra deps in this snippet
// Assumes GEMINI_API_KEY is set in the environment. Using the same model as cover letter route.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-1.5-flash";

export async function POST(req: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Missing GEMINI_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json();

    const jdRaw: string = (body.jobDescription ?? "").toString();
    const jobDescription = jdRaw.trim();

    if (!jobDescription) {
      return NextResponse.json(
        { error: "Required: jobDescription" },
        { status: 400 }
      );
    }

    const prompt = buildPromptFromJD(jobDescription);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(
        GEMINI_API_KEY
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.4,
          },
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Gemini error: ${text}` },
        { status: 500 }
      );
    }

    const data = await res.json();
    const output = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return NextResponse.json({ result: output });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

function buildPromptFromJD(jobDescription: string) {
  return `You are an expert resume writer.

Task: Based ONLY on the following Job Description (JD), infer the target role/title and generate a compact, ATS-friendly one-page resume in clean Markdown. Extract required skills and responsibilities from the JD. Where specific candidate data is missing, create reasonable placeholders that are generic and role-appropriate (no personal PII). Keep the tone professional and concise.

Important formatting requirements (must follow exactly):
  - Use Markdown with headings and bolded section titles. Do NOT output plain text. Do NOT wrap in code fences.
  - Section headings must be bolded (e.g., **Summary**, **Experience**, etc.) and/or use markdown heading syntax.
  - Use bullet points for lists except the Summary, which may be a short paragraph.
  - Keep content printable and compact for PDF.

Job Description (verbatim):
"""
${jobDescription}
"""

Output format (strictly in Markdown, in this structure and order):

# [FULL NAME]
_**[Inferred Role / Title]**_  
[City, Country] • [Email placeholder] • [LinkedIn placeholder]

**Summary**
 A short paragraph (2–4 sentences) aligned to the JD.

**Experience**
 - Company — Position (YYYY-MM – YYYY-MM) — Location
   - One bullet per line describing impact aligned to the JD
   - Keep to 2–4 bullets per role
 - Company — Position (YYYY-MM – YYYY-MM)
   - Bullets

**Education**
 - Institution — Field of Study (YYYY-MM – YYYY-MM) — Location
   - Optional short note (GPA, honors) if reasonable

**Skills**
  - Concise list of hard skills extracted from the JD.

**Certifications (optional)**
- Add only if clearly implied by the JD.

**Projects or Achievements (optional)**
- 1–2 impactful items mapped to the JD.

**Languages (optional)**
- 1–2 examples as placeholders.

Rules:
  - Infer the target role/title directly from the JD. Prioritize JD requirements.
  - Do not invent unrealistic claims; be professional and generic when uncertain.
  - Keep to a single printable page.
  - No tables. No code fences. Markdown only with bolded section titles.
  `;
}
