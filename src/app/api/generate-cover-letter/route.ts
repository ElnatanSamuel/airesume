import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: Request) {
  try {
    const { name, jobTitle, skills, experience, jobDescription, creativeScore,
      fromFirstName, fromLastName, phone, email,
      toFirstName, toLastName, company, department } =
      await req.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Server misconfiguration: GEMINI_API_KEY is not set." },
        { status: 500 }
      );
    }

    // Only require JD, jobTitle, and skills (can be array or comma-separated string)
    const skillsPresent = Array.isArray(skills)
      ? skills.length > 0
      : typeof skills === "string"
        ? skills.trim().length > 0
        : !!skills;
    if (!jobDescription || !jobTitle || !skillsPresent) {
      return NextResponse.json(
        { error: "Missing required fields: jobDescription, jobTitle, skills." },
        { status: 400 }
      );
    }

    // Safe fallbacks for optional fields
    const safeName = (name && String(name).trim())
      || [fromFirstName, fromLastName].filter(Boolean).join(" ").trim()
      || "Candidate";
    const safeExperience = (experience ?? "").toString();

    // Optional: lightly trim very long inputs to stay under free-tier/request limits
    const trim = (s: string, max = 6000) =>
      s?.length > max ? s.slice(0, max) + "..." : s;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);
    // Prefer flash (cheaper/fewer quota issues), fallback to pro
    const modelNames = ["gemini-1.5-flash", "gemini-1.5-pro"]; // default flash, then pro

    // Helper with model fallback and simple 429 handling
    const tryGenerate = async (prompt: string, temperature = 0.35) => {
      let lastErr: unknown = null;
      for (const modelName of modelNames) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature,
              maxOutputTokens: 800,
            },
          });
          const text = result.response.text();
          const content = (text || "").trim();
          if (content) return content;
        } catch (e: unknown) {
          lastErr = e as Error;
          // If 429 (rate limit/quota), try next model; otherwise break
          const status = typeof (e as any)?.status === "number" ? (e as any).status : undefined;
          const msg = typeof (e as any)?.message === "string" ? (e as any).message : undefined;
          if (!(status === 429 || (typeof msg === "string" && msg.includes("429")))) {
            break;
          }
        }
      }
      throw lastErr ?? new Error("Generation failed");
    };

    // Pass 1: Extract requirements and infer role from JD (JD is authoritative)
    const extractionPrompt = [
      "You are an expert career coach. Analyze the Job Description (JD) and extract the key requirements.",
      "If the provided jobTitle conflicts with the JD, follow the JD.",
      "Return a compact JSON with this exact shape (no extra commentary):",
      "{",
      "  \"inferredRole\": string,",
      "  \"keyRequirements\": string[],",
      "  \"mapping\": { \"requirement\": string, \"evidence\": string }[]",
      "}",
      "\n\nJob Description (JD):\n" + jobDescription,
      "\n\nCandidate Info:\n" +
        `Name: ${trim(safeName, 200)}\n` +
        `Job Title (user-provided): ${trim(jobTitle, 200)}\n` +
        `Skills: ${Array.isArray(skills) ? trim(skills.join(", "), 1000) : trim(String(skills ?? ""), 1000)}\n` +
        `Experience Summary: ${trim(safeExperience, 2000)}`,
    ].join("\n");

    let extractionRaw = "";
    try {
      // Lower temperature for extraction for more deterministic parsing
      extractionRaw = await tryGenerate(extractionPrompt, 0.2);
    } catch (e: unknown) {
      const status = typeof (e as any)?.status === "number" ? (e as any).status : undefined;
      const msg = typeof (e as any)?.message === "string" ? (e as any).message : undefined;
      if (status === 429 || (typeof msg === "string" && msg.includes("429"))) {
        return NextResponse.json(
          {
            error:
              "Rate limit or quota exceeded. Please wait a minute and try again, or switch models.",
          },
          { status: 429 }
        );
      }
      throw (e instanceof Error ? e : new Error("Extraction failed"));
    }

    // Try to parse JSON out of the extraction
    const match = extractionRaw.match(/\{[\s\S]*\}/);
    let extracted: {
      inferredRole?: string;
      keyRequirements?: string[];
      mapping?: { requirement: string; evidence: string }[];
    } = {};
    if (match) {
      try {
        extracted = JSON.parse(match[0]);
      } catch {}
    }

    const inferredRole =
      extracted.inferredRole || trim(jobTitle, 200) || "Candidate";
    const keyReqs =
      Array.isArray(extracted.keyRequirements) &&
      extracted.keyRequirements.length > 0
        ? extracted.keyRequirements
        : ["Relevant qualifications from the JD"];
    const mappingLines =
      Array.isArray(extracted.mapping) && extracted.mapping.length > 0
        ? extracted.mapping.map((m) => `- ${m.requirement}: ${m.evidence}`).join("\n")
        : `- Map the candidate's skills and experience to the JD requirements explicitly.`;

    // Pass 2: Generate the cover letter with stricter instructions
    // Determine temperature from creativeScore (0..1), default 0.35
    const creativity = Math.max(0, Math.min(1, typeof creativeScore === "number" ? creativeScore : parseFloat(String(creativeScore ?? 0.35)) || 0.35));

    const generationPrompt = [
      "Write a professional, tailored cover letter strictly aligned with the JD requirements.",
      "- If the user-provided jobTitle contradicts the JD, follow the JD.",
      "- Use the inferred role and mapping below.",
      "- Keep it concise (300–500 words), well-structured, and confident.",
      "- Include a brief closing paragraph and a sign-off with the applicant's name.",
      "- Explicitly reference 3–5 of the most important JD requirements.",
      `- Creativity guidance (0–1): ${creativity}. Use more varied phrasing at higher values; stay precise at lower values.`,
      "- Avoid hallucinations.",
      "- Personalization: If recipient info is provided, address the letter using that data (e.g., 'Dear <First> <Last>' or 'Hiring Team' if missing). Mention company and department when relevant.",
      "- Signature: Include sender contact details (email and phone) when provided.",
      "\n\nJob Description (authoritative):\n" + jobDescription,
      "\nInferred Role: " + inferredRole,
      "\nKey Requirements: \n- " + keyReqs.join("\n- "),
      "\nCandidate Mapping (requirement -> evidence):\n" + mappingLines,
      "\nCandidate Info:\n" +
        `Name: ${trim(safeName, 200)}\n` +
        `Skills: ${Array.isArray(skills) ? trim(skills.join(", "), 1000) : trim(String(skills ?? ""), 1000)}\n` +
        `Experience Summary: ${trim(safeExperience, 2000)}` +
        (fromFirstName || fromLastName || email || phone
          ? "\nSender (From):\n" +
            `First Name: ${trim(String(fromFirstName ?? ""), 200)}\n` +
            `Last Name: ${trim(String(fromLastName ?? ""), 200)}\n` +
            `Email: ${trim(String(email ?? ""), 200)}\n` +
            `Phone: ${trim(String(phone ?? ""), 200)}`
          : "") +
        (toFirstName || toLastName || company || department
          ? "\nRecipient (To):\n" +
            `First Name: ${trim(String(toFirstName ?? ""), 200)}\n` +
            `Last Name: ${trim(String(toLastName ?? ""), 200)}\n` +
            `Company: ${trim(String(company ?? ""), 200)}\n` +
            `Department: ${trim(String(department ?? ""), 200)}`
          : ""),
    ].join("\n");

    let content = "";
    try {
      content = await tryGenerate(generationPrompt, creativity);
    } catch (e: unknown) {
      const status = typeof (e as any)?.status === "number" ? (e as any).status : undefined;
      const msg = typeof (e as any)?.message === "string" ? (e as any).message : undefined;
      if (status === 429 || (typeof msg === "string" && msg.includes("429"))) {
        return NextResponse.json(
          {
            error:
              "Rate limit or quota exceeded. Please wait a minute and try again, or switch models.",
          },
          { status: 429 }
        );
      }
      throw (e instanceof Error ? e : new Error("Generation failed"));
    }

    if (!content) {
      return NextResponse.json(
        { error: "No content generated from the AI model." },
        { status: 502 }
      );
    }

    return NextResponse.json({ coverLetter: content });
  } catch (err: unknown) {
    console.error("/api/generate-cover-letter error:", err);
    return NextResponse.json(
      { error: "Failed to generate cover letter." },
      { status: 500 }
    );
  }
}
