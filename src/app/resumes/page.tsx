"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function ResumePage() {
  const [jobDescription, setJobDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [toast, setToast] = useState<{ show: boolean; message: string }>({
    show: false,
    message: "",
  });
  const [editMode, setEditMode] = useState(false);
  const [profile, setProfile] = useState({
    name: "",
    title: "",
    location: "",
    email: "",
    socials: "",
  });
  const [summary, setSummary] = useState("");
  const [experience, setExperience] = useState("");
  const [education, setEducation] = useState("");
  const [skills, setSkills] = useState("");
  const [certifications, setCertifications] = useState("");
  const [projects, setProjects] = useState("");
  const [languages, setLanguages] = useState("");
  const [savedMd, setSavedMd] = useState("");
  // Cache the latest saved markdown to avoid async state races for PDF snapshot
  const lastSavedMd = useRef<string>("");
  const [experienceItems, setExperienceItems] = useState<
    Array<{
      company: string;
      position: string;
      from: string; // YYYY-MM
      to: string; // YYYY-MM
      location?: string;
      description: string; // bullets per line
    }>
  >([]);
  const [educationItems, setEducationItems] = useState<
    Array<{
      institution: string;
      fieldOfStudy: string;
      from: string;
      to: string;
      location?: string;
      description: string;
    }>
  >([]);

  // Sidebar/nav state (mirrors cover letter page)
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const disableSubmit = useMemo(() => {
    return jobDescription.trim().length === 0;
  }, [jobDescription]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disableSubmit) return;
    setLoading(true);
    setResult("");
    try {
      const res = await fetch("/api/generate-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate");
      const out = data.result || "";
      setResult(out);
      // Parse into editable fields and enter edit mode
      try {
        parseResultToState(out);
        setEditMode(true);
        const md = sanitize(normalizeDatesInMd(out));
        setSavedMd(md);
        lastSavedMd.current = md;
      } catch {
        // If parsing fails, still show the raw result, keep editMode off
        setEditMode(false);
      }
    } catch (err: any) {
      setToast({ show: true, message: err?.message || "Generation failed" });
      setTimeout(() => setToast({ show: false, message: "" }), 1800);
    } finally {
      setLoading(false);
    }
  };

  // Parse generated markdown into state (best-effort)
  const parseResultToState = (md: string) => {
    const lines = md.split(/\r?\n/);
    // Header
    const nameLine = lines.find((l) => l.trim().startsWith("# ")) || "";
    const name = nameLine.replace(/^#\s+/, "").trim();
    // Title: line with surrounding underscores
    const titleIdx = lines.findIndex((l) => /^_.*_\s*$/.test(l.trim()));
    const title =
      titleIdx >= 0
        ? lines[titleIdx]
            .replace(/^_+/, "")
            .replace(/_+$/, "")
            .replace(/^\*\*|\*\*$/g, "")
            .trim()
        : "";
    // Contact line: next non-empty that contains separators
    let contact = "";
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t && (t.includes(" • ") || t.includes("·") || t.includes("|"))) {
        contact = t;
        break;
      }
    }
    let location = "";
    let email = "";
    let socials = "";
    if (contact) {
      const parts = contact.split(/\s*[•|·]\s*/);
      for (const p of parts) {
        const v = p.trim();
        if (!v) continue;
        if (v.includes("@")) email = v;
        else if (!location) location = v;
        else socials = socials ? `${socials}, ${v}` : v;
      }
    }

    // Sections by bold headings like **Summary**, **Experience**, etc. (robust to optional tag)
    const findHeadingIndex = (labels: string[]) => {
      const normalized = lines.map((l) => l.replace(/\s/g, "").toLowerCase());
      for (const lbl of labels) {
        const key = `**${lbl.toLowerCase()}**`;
        const idx = normalized.indexOf(key);
        if (idx !== -1) return idx;
      }
      return -1;
    };
    const getSection = (label: string, altLabels: string[] = []) => {
      const start = findHeadingIndex([label, ...altLabels]);
      if (start === -1) return "";
      let i = start + 1;
      const buf: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (/^\*\*(.+)\*\*\s*$/.test(t)) break; // next section
        buf.push(lines[i]);
        i++;
      }
      return buf.join("\n").trim();
    };

    setProfile({ name, title, location, email, socials });
    setSummary(getSection("Summary"));
    // Parse Experience into structured items: "- Company — Position (YYYY-MM – YYYY-MM) — Location"
    const expText = getSection("Experience");
    const expLines = expText.split(/\r?\n/);
    // split on dashes that are OUTSIDE parentheses so date ranges remain intact
    const splitTopLevel = (header: string): string[] => {
      const parts: string[] = [];
      let buf = "";
      let depth = 0;
      for (let i = 0; i < header.length; i++) {
        const ch = header[i];
        if (ch === "(") depth++;
        if (ch === ")" && depth > 0) depth--;
        // detect dash-like separators surrounded by spaces at top level
        if (
          depth === 0 &&
          (ch === "—" || ch === "–" || ch === "-") &&
          i > 0 &&
          i + 1 < header.length &&
          header[i - 1] === " " &&
          header[i + 1] === " "
        ) {
          if (buf.trim()) parts.push(buf.trim());
          buf = "";
          continue;
        }
        buf += ch;
      }
      if (buf.trim()) parts.push(buf.trim());
      return parts;
    };
    const parseExpHeader = (header: string) => {
      const parts = splitTopLevel(header);
      // Identify the part with parentheses as the position(+dates)
      let company = "";
      let position = "";
      let from = "";
      let to = "";
      let location: string | undefined;
      let posIdx = parts.findIndex((p) => /\([^)]*\)/.test(p));
      if (posIdx >= 0) {
        const m = parts[posIdx].match(/^(.*?)\s*\(([^)]*)\)\s*$/);
        if (m) {
          position = m[1].trim();
          const { from: f, to: t } = normalizeRange(m[2]);
          from = f;
          to = t;
        } else {
          position = parts[posIdx].trim();
        }
        company = parts[0] || "";
        // location likely last if exists
        if (parts.length > posIdx + 1) location = parts[parts.length - 1];
      } else {
        // No parentheses; assume [company, position, location?]
        company = parts[0] || "";
        position = parts[1] || "";
        if (parts[2]) location = parts[2];
      }
      return { company, position, from, to, location };
    };
    const expItems: Array<{
      company: string;
      position: string;
      from: string;
      to: string;
      location?: string;
      description: string;
    }> = [];
    let curExp: {
      company: string;
      position: string;
      from: string;
      to: string;
      location?: string;
      description: string;
    } | null = null;
    for (const raw of expLines) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (/^-\s+/.test(line)) {
        // Push previous
        if (curExp) expItems.push({ ...curExp });
        // Parse header
        const header = line.replace(/^-\s+/, "");
        const { company, position, from, to, location } =
          parseExpHeader(header);
        curExp = { company, position, from, to, location, description: "" };
        continue;
      }
      // Bullet line under current experience
      if (curExp && /^\s*[-*\u2022]\s+/.test(line)) {
        const bullet = line.replace(/^\s*[-*\u2022]\s+/, "").trim();
        curExp.description = curExp.description
          ? `${curExp.description}\n${bullet}`
          : bullet;
      }
    }
    if (curExp) expItems.push({ ...curExp });
    setExperienceItems(expItems);
    setExperience("");

    // Parse Education into structured items: "- Institution — Field of Study (YYYY-MM – YYYY-MM) — Location"
    const eduText = getSection("Education");
    const eduLines = eduText.split(/\r?\n/);
    const parseEduHeader = (header: string) => {
      const parts = splitTopLevel(header);
      let institution = "";
      let fieldOfStudy = "";
      let from = "";
      let to = "";
      let location: string | undefined;
      let fieldIdx = parts.findIndex((p) => /\([^)]*\)/.test(p));
      if (fieldIdx >= 0) {
        const m = parts[fieldIdx].match(/^(.*?)\s*\(([^)]*)\)\s*$/);
        if (m) {
          fieldOfStudy = m[1].trim();
          const { from: f, to: t } = normalizeRange(m[2]);
          from = f;
          to = t;
        } else {
          fieldOfStudy = parts[fieldIdx].trim();
        }
        institution = parts[0] || "";
        // location likely last if exists
        if (parts.length > fieldIdx + 1) location = parts[parts.length - 1];
      } else {
        // No parentheses; assume [institution, fieldOfStudy, location?]
        institution = parts[0] || "";
        fieldOfStudy = parts[1] || "";
        if (parts[2]) location = parts[2];
      }
      return { institution, fieldOfStudy, from, to, location };
    };
    const eduItems: Array<{
      institution: string;
      fieldOfStudy: string;
      from: string;
      to: string;
      location?: string;
      description: string;
    }> = [];
    let curEdu: {
      institution: string;
      fieldOfStudy: string;
      from: string;
      to: string;
      location?: string;
      description: string;
    } | null = null;
    for (const raw of eduLines) {
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (/^-\s+/.test(line)) {
        if (curEdu) eduItems.push({ ...curEdu });
        const header = line.replace(/^-\s+/, "");
        const { institution, fieldOfStudy, from, to, location } =
          parseEduHeader(header);
        curEdu = {
          institution,
          fieldOfStudy,
          from,
          to,
          location,
          description: "",
        };
        continue;
      }
      if (curEdu && /^\s*[-*\u2022]\s+/.test(line)) {
        const bullet = line.replace(/^\s*[-*\u2022]\s+/, "").trim();
        curEdu.description = curEdu.description
          ? `${curEdu.description}\n${bullet}`
          : bullet;
      }
    }
    if (curEdu) eduItems.push({ ...curEdu });
    setEducationItems(eduItems);
    setEducation("");
    setSkills(getSection("Skills"));
    setCertifications(
      getSection("Certifications", ["Certifications(optional)"])
    );
    setProjects(
      getSection("Projects or Achievements", [
        "Projects or Achievements (optional)",
        "Projects",
        "Achievements",
      ])
    );
    const langs = getSection("Languages", ["Languages (optional)"]);
    setLanguages(langs);

    // Parsed items now populate editors
  };

  const sanitize = (md: string) =>
    md
      .replace(/_/g, "")
      .replace(/--/g, " | ")
      // remove bracketed qualifiers like (optional), (Inferred), (Native ...)
      .replace(
        /\s*\((?:optional|inferred|native|fluent|proficient|basic|intermediate|advanced)[^)]*\)/gi,
        ""
      )
      // also remove any parenthetical in section headings, e.g., **Languages (optional)**
      .replace(
        /\*\*([^*]+?)\s*\([^)]*\)\s*\*\*/g,
        (_m, title) => `**${title.trim()}**`
      );

  // Normalize date ranges inside parentheses in markdown, e.g. (2022-06 – 2023-08) -> (Jun 2022 - Aug 2023)
  const normalizeDatesInMd = (md: string): string => {
    return md.replace(/\(([^)]+)\)/g, (full, inner) => {
      const { from, to } = normalizeRange(inner);
      if (!from && !to) return full;
      return `(${from}${to ? ` - ${to}` : ""})`;
    });
  };

  // Helpers to normalize date strings like "2025-06", "2025", "Jun 2025", "Present"
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const toMonYYYY = (s: string): string => {
    const t = s.trim();
    if (!t) return "";
    if (/^present$/i.test(t)) return "Present";
    // YYYY-MM or YYYY-M or YYYY-MM-DD
    const m1 = t.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
    if (m1) {
      const y = parseInt(m1[1], 10);
      const m = Math.min(12, Math.max(1, parseInt(m1[2], 10)));
      return `${monthNames[m - 1]} ${y}`;
    }
    // MM-YYYY or M-YYYY
    const m1b = t.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m1b) {
      const y = parseInt(m1b[2], 10);
      const m = Math.min(12, Math.max(1, parseInt(m1b[1], 10)));
      return `${monthNames[m - 1]} ${y}`;
    }
    // Month YYYY
    const m2 = t.match(
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{4})$/i
    );
    if (m2) {
      const mon = m2[1].slice(0, 3);
      return `${mon[0].toUpperCase()}${mon.slice(1).toLowerCase()} ${m2[2]}`;
    }
    // YYYY only
    const m3 = t.match(/^(\d{4})$/);
    if (m3) return m3[1];
    // MM only -> Month abbrev (no year info)
    const m4 = t.match(/^(\d{1,2})$/);
    if (m4) {
      const m = Math.min(12, Math.max(1, parseInt(m4[1], 10)));
      return monthNames[m - 1];
    }
    return t; // fallback unchanged
  };
  const normalizeRange = (range: string): { from: string; to: string } => {
    const r = range.trim();
    if (!r) return { from: "", to: "" };
    // Split ONLY on separators with surrounding spaces to avoid breaking YYYY-MM
    const parts = r
      .split(/\s+(?:–|—|-|to)\s+/i)
      .map((x) => x.trim())
      .filter(Boolean);
    const fromRaw = parts[0] || r;
    const toRaw = parts[1] || "";
    return { from: toMonYYYY(fromRaw), to: toMonYYYY(toRaw) };
  };

  const composeMarkdownFromState = (): string => {
    const skillsBlock = skills
      ? skills.includes("\n")
        ? skills
        : skills
            .split(/,\s*/)
            .filter(Boolean)
            .map((s) => `- ${s}`)
            .join("\n")
      : "";
    const opt = (title: string, body: string) =>
      body && body.trim().length > 0 ? `\n**${title}**\n${body.trim()}\n` : "";

    const expBlock = experienceItems.length
      ? experienceItems
          .map((it) => {
            const range = `${it.from || "Mon YYYY"} - ${it.to || "Mon YYYY"}`;
            const header = `- ${it.company || "[Company]"} — ${
              it.position || "[Position]"
            } (${range})${it.location ? ` — ${it.location}` : ""}`;
            const descLines = (it.description || "")
              .split(/\r?\n/)
              .filter(Boolean)
              .map((l) => `  - ${l}`);
            return [header, ...descLines].join("\n");
          })
          .join("\n")
      : "";

    const eduBlock = educationItems.length
      ? educationItems
          .map((it) => {
            const range = `${it.from || "Mon YYYY"} - ${it.to || "Mon YYYY"}`;
            const header = `- ${it.institution || "[Institution]"} — ${
              it.fieldOfStudy || "[Field of Study]"
            } (${range})${it.location ? ` — ${it.location}` : ""}`;
            const desc = (it.description || "").trim();
            return desc ? `${header}\n  - ${desc}` : header;
          })
          .join("\n")
      : "";

    return [
      `# ${profile.name || "[FULL NAME]"}`,
      `_${profile.title ? `**${profile.title}**` : "**[Role / Title]**"}_  `,
      `${profile.location || "[City, Country]"} • ${
        profile.email || "[Email]"
      } • ${profile.socials || "[LinkedIn/Website]"}`,
      opt("Summary", summary),
      opt("Experience", expBlock),
      opt("Education", eduBlock),
      opt("Skills", skillsBlock),
      opt("Certifications (optional)", certifications),
      opt("Projects or Achievements (optional)", projects),
      opt("Languages (optional)", languages),
    ].join("\n");
  };

  const copyToClipboard = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setToast({ show: true, message: "Copied to clipboard" });
    } catch {
      setToast({ show: true, message: "Failed to copy" });
    } finally {
      setTimeout(() => setToast((t) => ({ ...t, show: false })), 1800);
    }
  };

  // Minimal markdown to HTML (headings, bold, lists, paragraphs)
  const mdToHtml = (md: string): string => {
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const lines = md.split(/\r?\n/);
    const htmlParts: string[] = [];
    let inUl = false;
    let currentSection = "";
    // For Skills special 2-column rendering (first 4 items in first column)
    let collectingSkills = false;
    let skillsBuffer: string[] = [];
    // Header staging: 0=name (bold/center), 1=title (bold/center), 2=contacts (normal/center)
    let headerStage = 0;

    const flushSkills = () => {
      if (collectingSkills) {
        const col1 = skillsBuffer.slice(0, 4);
        const col2 = skillsBuffer.slice(4);
        htmlParts.push(
          '<div class="skills-columns" style="display:grid; grid-template-columns:1fr 1fr; gap:24px;">'
        );
        htmlParts.push("<ul>");
        for (const it of col1) htmlParts.push(`<li>${it}</li>`);
        htmlParts.push("</ul>");
        htmlParts.push("<ul>");
        for (const it of col2) htmlParts.push(`<li>${it}</li>`);
        htmlParts.push("</ul>");
        htmlParts.push("</div>");
        collectingSkills = false;
        skillsBuffer = [];
      }
    };

    const flushUl = () => {
      // If we were collecting Skills, flush that special layout instead
      if (collectingSkills) {
        flushSkills();
        return;
      }
      if (inUl) {
        htmlParts.push("</ul>");
        inUl = false;
      }
    };

    for (let raw of lines) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        flushUl();
        htmlParts.push('<div class="spacer"></div>');
        continue;
      }

      // Headings
      if (line.startsWith("# ")) {
        flushUl();
        htmlParts.push(`<h1>${escape(line.slice(2))}</h1>`);
        continue;
      }
      if (line.startsWith("## ")) {
        flushUl();
        htmlParts.push(
          `<h2 class="section-title" style="font-weight:700;border-bottom:1px solid #000;padding-bottom:4px;margin:12px 0 8px;">${escape(
            line.slice(3)
          )}</h2>`
        );
        continue;
      }
      if (line.startsWith("### ")) {
        flushUl();
        htmlParts.push(
          `<h3 class="section-title" style="font-weight:700;border-bottom:1px solid #000;padding-bottom:3px;margin:10px 0 6px;">${escape(
            line.slice(4)
          )}</h3>`
        );
        continue;
      }

      // Section headings written as bold-only lines like **Skills**
      if (/^\*\*[^*]+\*\*$/.test(line)) {
        flushUl();
        const title = line
          .replace(/^\*\*|\*\*$/g, "")
          .replace(/\s*\([^)]*\)\s*$/, "")
          .trim();
        currentSection = title;
        htmlParts.push(
          `<p class="section-title" style="font-weight:700;border-bottom:1px solid #000;padding-bottom:4px;margin:12px 0 8px;"><strong>${escape(
            title
          )}</strong></p>`
        );
        continue;
      }

      // Lists
      if (/^[\-\u2022]\s+/.test(line)) {
        if (currentSection.toLowerCase() === "skills") {
          // Collect skills items and render later as two fixed columns
          collectingSkills = true;
          const item = line.replace(/^[\-\u2022]\s+/, "");
          const htmlItem = `${escape(item).replace(
            /\*\*(.*?)\*\*/g,
            "<strong>$1</strong>"
          )}`;
          skillsBuffer.push(htmlItem);
        } else {
          if (!inUl) {
            htmlParts.push("<ul>");
            inUl = true;
          }
          const item = line.replace(/^[\-\u2022]\s+/, "");
          htmlParts.push(
            `<li>${escape(item).replace(
              /\*\*(.*?)\*\*/g,
              "<strong>$1</strong>"
            )}</li>`
          );
        }
        continue;
      }

      // Bold
      // If we were collecting Skills and we hit a non-list line, flush the skills columns first
      if (collectingSkills) {
        flushSkills();
      }
      // Header lines at the very top before any section headings
      if (!currentSection) {
        if (headerStage === 0) {
          htmlParts.push(
            `<p style="text-align:center;font-weight:700;font-size:22px;">${escape(
              line
            )}</p>`
          );
          headerStage = 1;
          continue;
        } else if (headerStage === 1) {
          htmlParts.push(
            `<p style="text-align:center;font-weight:700;font-size:16px;">${escape(
              line
            )}</p>`
          );
          headerStage = 2;
          continue;
        } else {
          // Contacts (one or many lines): normal weight, avoid bold replacements entirely
          htmlParts.push(
            `<p style="text-align:center;font-weight:400;font-size:14px;">${escape(
              line
            )}</p>`
          );
          continue;
        }
      }

      // Experience section: render header row with left (Company, Position) and right-aligned dates
      if (currentSection && currentSection.toLowerCase() === "experience") {
        const t = line.trim();
        if (t && !/^[\-\u2022]\s+/.test(t)) {
          // Try to pull out a month-year date range, optionally with "Present"
          const dateRangeRegex =
            /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s*(?:[–-]\s*(?:Present|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}))?/i;
          let right = "";
          let leftText = t;
          const m = t.match(dateRangeRegex);
          if (m) {
            right = m[0];
            leftText = t
              .replace(m[0], "")
              .replace(/\s*[–-]\s*$/, "")
              .replace(/\s*\([^)]*\)\s*$/, "")
              .trim();
          }
          // Split left into Company, Position using first comma
          let company = leftText;
          let position = "";
          const commaIdx = leftText.indexOf(",");
          if (commaIdx !== -1) {
            company = leftText.slice(0, commaIdx);
            position = leftText.slice(commaIdx + 1);
          }
          const leftHtml = `<strong>${escape(company.trim())}</strong>${
            position.trim() ? `, <em>${escape(position.trim())}</em>` : ""
          }`;
          htmlParts.push(
            `<div class="exp-row" style="display:flex;align-items:baseline;justify-content:space-between;"><div class="left">${leftHtml}</div><div class="right" style="white-space:nowrap;">${escape(
              right
            )}</div></div>`
          );
          continue;
        }
      }
      const withBold = escape(line).replace(
        /\*\*(.*?)\*\*/g,
        "<strong>$1</strong>"
      );
      htmlParts.push(`<p>${withBold}</p>`);
    }
    flushUl();
    return htmlParts.join("\n");
  };

  const downloadPdf = () => {
    const md = editMode
      ? lastSavedMd.current || savedMd || composeMarkdownFromState()
      : result;
    if (!md) return;
    const content = mdToHtml(md);
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(`<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>Resume</title>
  <link href=\"https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap\" rel=\"stylesheet\" />
  <style>
    :root { --text:#111; --muted:#555; }
    * { box-sizing: border-box; }
    body { font-family: 'Lato', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, Noto Sans, \"Apple Color Emoji\", \"Segoe UI Emoji\", sans-serif; color: var(--text); margin: 0; }
    .page { width: 8.5in; min-height: 11in; padding: 0.8in; margin: 0 auto; }
    h1 { font-size: 22px; margin: 0 0 6px; }
    h2 { font-size: 14px; margin: 18px 0 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px; border-bottom: 1px solid #000; padding-bottom: 4px; }
    h3 { font-size: 13px; margin: 10px 0 6px; border-bottom: 1px solid #000; padding-bottom: 3px; }
    .section-title { font-weight:700; border-bottom:1px solid #000; padding-bottom:4px; margin:12px 0 8px; }
    .exp-row { display: flex; align-items: baseline; justify-content: space-between; }
    .exp-row .right { white-space: nowrap; }
    p { margin: 4px 0; line-height: 1.45; }
    .spacer { height: 6px; }
    ul { margin: 6px 0 10px 18px; padding: 0; }
    li { margin: 2px 0; line-height: 1.4; }
    header { margin-bottom: 8px; }
    @media print {
      @page { margin: 0; size: A4; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page { padding: 0.8in; }
      .actions { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="page">
    ${content}
  </div>
  <script>window.onload = () => { window.focus(); window.print(); };</script>
</body>
</html>`);
    win.document.close();
  };

  return (
    <div className="h-screen w-full bg-white text-black flex">
      {/* Fixed sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-[13rem]" : "w-12"
        } hidden lg:flex flex-col border-r border-black/[.08] bg-white`}
      >
        {/* Sidebar header */}
        <div
          className={`flex items-center h-14 border-b border-black/[.06] ${
            sidebarOpen ? "px-3 gap-2" : "px-0 justify-center"
          }`}
        >
          {sidebarOpen ? (
            <div className="flex items-center gap-18 justify-between w-full">
              <div className="flex items-center gap-2">
                <img src="/logo.svg" alt="Logo" className="h-7 w-7" />
                <span className="font-semibold">Sync</span>
              </div>
              <button
                onClick={() => setSidebarOpen((v) => !v)}
                className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-blue-500/[.1] text-blue-500 hover:bg-black/85"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-4 w-4"
                >
                  <path d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-blue-500/[.1] text-blue-500 hover:bg-black/85"
              title="Expand sidebar"
              aria-label="Expand sidebar"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
        {/* Sidebar nav */}
        {sidebarOpen ? (
          <nav className="p-3 space-y-2">
            {[
              {
                label: "Cover Letters",
                key: "cover",
                href: "/",
                active: pathname === "/",
              },
              {
                label: "Resumes",
                key: "resumes",
                href: "/resumes",
                active: pathname?.startsWith("/resumes"),
              },
            ].map((item) => (
              <Link href={item.href} key={item.key}>
                <button
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    item.active
                      ? "bg-blue-500/[.1] text-blue-500"
                      : "hover:bg-blue-500/[.05]"
                  }`}
                  title={item.label}
                  aria-label={item.label}
                >
                  {/* Icon */}
                  {item.key === "cover" ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-5 w-5"
                    >
                      <rect x="3" y="6" width="18" height="12" rx="2" ry="2" />
                      <path d="M3 8l9 6 9-6" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-5 w-5"
                    >
                      <path d="M7 3h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                      <path d="M15 3v4h4" />
                    </svg>
                  )}
                  <span>{item.label}</span>
                </button>
              </Link>
            ))}
          </nav>
        ) : (
          <nav className="p-2 space-y-2 flex flex-col items-center">
            {[
              {
                key: "cover",
                label: "Cover Letters",
                href: "/",
                active: pathname === "/",
              },
              {
                key: "resumes",
                label: "Resumes",
                href: "/resumes",
                active: pathname?.startsWith("/resumes"),
              },
            ].map((item) => (
              <button
                key={item.key}
                title={item.label}
                onClick={() => router.push(item.href)}
                className={`w-9 h-9 inline-flex items-center justify-center rounded-lg text-sm ${
                  item.active
                    ? "bg-blue-500/[.1] text-blue-500"
                    : "hover:bg-blue-500/[.05]"
                }`}
                aria-label={item.label}
              >
                {item.key === "cover" ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-5 w-5"
                  >
                    <rect x="3" y="6" width="18" height="12" rx="2" ry="2" />
                    <path d="M3 8l9 6 9-6" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-5 w-5"
                  >
                    <path d="M7 3h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                    <path d="M15 3v4h4" />
                  </svg>
                )}
              </button>
            ))}
          </nav>
        )}
      </aside>
      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 p-0">
          {/* Form */}
          <main className="lg:col-span-7 h-[calc(100vh-2rem)] pt-6 overflow-auto pr-1 bg-gray-50">
            <h1 className="text-xl font-semibold mb-3 px-4">
              {editMode ? "Edit your resume" : "Generate your resume"}
            </h1>
            {!editMode ? (
              <form onSubmit={onSubmit} className="px-4 pb-24">
                <div className="space-y-4">
                  <div className="flex flex-col">
                    <label className="text-sm mb-1" htmlFor="jobDescription">
                      Job Description
                    </label>
                    <textarea
                      id="jobDescription"
                      name="jobDescription"
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      className="rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-44"
                      placeholder="Paste the JD here..."
                      required
                      maxLength={2000}
                    />
                    <div className="mt-1 text-xs text-black/60 self-end">
                      {jobDescription.length}/2000
                    </div>
                  </div>
                </div>
                <div className="sticky pt-4 bottom-0 left-0 right-0 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-t border-black/10 py-3 mt-6">
                  <button
                    type="submit"
                    disabled={loading || disableSubmit}
                    className="w-full rounded-lg bg-blue-500/[.1] text-blue-500 py-3 font-medium hover:bg-blue-500/[.05] disabled:opacity-60"
                  >
                    {loading ? "Generating..." : "Generate"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="px-4 pb-24">
                {/* Profile */}
                <div className="border-b border-black/10 pb-4 mb-4">
                  <h2 className="text-sm font-semibold mb-3">Profile</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col">
                      <label className="text-xs mb-1">Name</label>
                      <input
                        value={profile.name}
                        onChange={(e) =>
                          setProfile({ ...profile, name: e.target.value })
                        }
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-xs mb-1">Title</label>
                      <input
                        value={profile.title}
                        onChange={(e) =>
                          setProfile({ ...profile, title: e.target.value })
                        }
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-xs mb-1">Location</label>
                      <input
                        value={profile.location}
                        onChange={(e) =>
                          setProfile({ ...profile, location: e.target.value })
                        }
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                    </div>
                    <div className="flex flex-col">
                      <label className="text-xs mb-1">Email</label>
                      <input
                        value={profile.email}
                        onChange={(e) =>
                          setProfile({ ...profile, email: e.target.value })
                        }
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                    </div>
                    <div className="sm:col-span-2 flex flex-col">
                      <label className="text-xs mb-1">
                        Socials (LinkedIn, site, etc.)
                      </label>
                      <input
                        value={profile.socials}
                        onChange={(e) =>
                          setProfile({ ...profile, socials: e.target.value })
                        }
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        const md = sanitize(composeMarkdownFromState());
                        setSavedMd(md);
                        lastSavedMd.current = md;
                      }}
                      className="h-8 px-3 text-xs rounded-md bg-blue-500/[.1] text-blue-500 border border-black/10 hover:bg-black/5"
                    >
                      Save Profile
                    </button>
                  </div>
                </div>

                {/* Summary */}
                <div className="border-b border-black/10 pb-4 mb-4">
                  <h2 className="text-sm font-semibold mb-2">Summary</h2>
                  <textarea
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    className="w-full rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-28"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        const md = sanitize(composeMarkdownFromState());
                        setSavedMd(md);
                        lastSavedMd.current = md;
                      }}
                      className="h-8 px-3 text-xs bg-blue-500/[.1] text-blue-500 rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Save Summary
                    </button>
                  </div>
                </div>

                {/* Experience */}
                <div className="border-b border-black/10 pb-4 mb-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold mb-2">Experience</h2>
                    <button
                      onClick={() =>
                        setExperienceItems([
                          ...experienceItems,
                          {
                            company: "",
                            position: "",
                            from: "",
                            to: "",
                            location: "",
                            description: "",
                          },
                        ])
                      }
                      className="h-8 px-3 mb-4 text-xs bg-blue-500/[.1] text-blue-500 rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Add
                    </button>
                  </div>
                  {experienceItems.length === 0 && (
                    <div className="mb-2 text-xs text-black/60">
                      No structured items parsed. Use Add to create entries.
                    </div>
                  )}
                  {experienceItems.map((it, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3"
                    >
                      <input
                        placeholder="Company"
                        value={it.company}
                        onChange={(e) => {
                          const arr = [...experienceItems];
                          arr[idx] = { ...arr[idx], company: e.target.value };
                          setExperienceItems(arr);
                        }}
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                      <input
                        placeholder="Position"
                        value={(it as any).position || ""}
                        onChange={(e) => {
                          const arr = [...experienceItems];
                          arr[idx] = {
                            ...arr[idx],
                            position: e.target.value,
                          } as any;
                          setExperienceItems(arr);
                        }}
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                      <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                        <input
                          placeholder="From (e.g., Jun 2025)"
                          value={(it as any).from || ""}
                          onChange={(e) => {
                            const arr = [...experienceItems];
                            arr[idx] = {
                              ...arr[idx],
                              from: toMonYYYY(e.target.value),
                            } as any;
                            setExperienceItems(arr);
                          }}
                          className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                        />
                        <input
                          placeholder="To (e.g., Aug 2025 or Present)"
                          value={(it as any).to || ""}
                          onChange={(e) => {
                            const arr = [...experienceItems];
                            arr[idx] = {
                              ...arr[idx],
                              to: toMonYYYY(e.target.value),
                            } as any;
                            setExperienceItems(arr);
                          }}
                          className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                        />
                      </div>
                      <input
                        placeholder="Location"
                        value={it.location}
                        onChange={(e) => {
                          const arr = [...experienceItems];
                          arr[idx] = { ...arr[idx], location: e.target.value };
                          setExperienceItems(arr);
                        }}
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                      <textarea
                        placeholder="Description (one bullet per line)"
                        value={it.description}
                        onChange={(e) => {
                          const arr = [...experienceItems];
                          arr[idx] = {
                            ...arr[idx],
                            description: e.target.value,
                          };
                          setExperienceItems(arr);
                        }}
                        className="sm:col-span-2 rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-24"
                      />
                    </div>
                  ))}
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        const md = sanitize(composeMarkdownFromState());
                        setSavedMd(md);
                        lastSavedMd.current = md;
                      }}
                      className="h-8 px-3 bg-blue-500/[.1] text-blue-500 text-xs rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Save Experience
                    </button>
                  </div>
                </div>

                {/* Education */}
                <div className="border-b border-black/10 pb-4 mb-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold mb-2">Education</h2>
                    <button
                      onClick={() =>
                        setEducationItems([
                          ...educationItems,
                          {
                            institution: "",
                            fieldOfStudy: "",
                            from: "",
                            to: "",
                            location: "",
                            description: "",
                          },
                        ])
                      }
                      className="h-8 px-3 mb-4 bg-blue-500/[.1] text-blue-500 text-xs rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Add
                    </button>
                  </div>
                  {educationItems.length === 0 && (
                    <div className="mb-2 text-xs text-black/60">
                      No structured items parsed. Use Add to create entries.
                    </div>
                  )}
                  {educationItems.map((it, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3"
                    >
                      <input
                        placeholder="Institution"
                        value={(it as any).institution || ""}
                        onChange={(e) => {
                          const arr = [...educationItems];
                          arr[idx] = {
                            ...arr[idx],
                            institution: e.target.value,
                          } as any;
                          setEducationItems(arr);
                        }}
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                      <input
                        placeholder="Field of Study"
                        value={(it as any).fieldOfStudy || ""}
                        onChange={(e) => {
                          const arr = [...educationItems];
                          arr[idx] = {
                            ...arr[idx],
                            fieldOfStudy: e.target.value,
                          } as any;
                          setEducationItems(arr);
                        }}
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                      <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                        <input
                          placeholder="From (e.g., Sep 2020)"
                          value={(it as any).from || ""}
                          onChange={(e) => {
                            const arr = [...educationItems];
                            arr[idx] = {
                              ...arr[idx],
                              from: toMonYYYY(e.target.value),
                            } as any;
                            setEducationItems(arr);
                          }}
                          className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                        />
                        <input
                          placeholder="To (e.g., Jun 2024 or Present)"
                          value={(it as any).to || ""}
                          onChange={(e) => {
                            const arr = [...educationItems];
                            arr[idx] = {
                              ...arr[idx],
                              to: toMonYYYY(e.target.value),
                            } as any;
                            setEducationItems(arr);
                          }}
                          className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                        />
                      </div>
                      <input
                        placeholder="Location"
                        value={it.location}
                        onChange={(e) => {
                          const arr = [...educationItems];
                          arr[idx] = { ...arr[idx], location: e.target.value };
                          setEducationItems(arr);
                        }}
                        className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                      />
                      <textarea
                        placeholder="Description (optional)"
                        value={it.description}
                        onChange={(e) => {
                          const arr = [...educationItems];
                          arr[idx] = {
                            ...arr[idx],
                            description: e.target.value,
                          };
                          setEducationItems(arr);
                        }}
                        className="sm:col-span-2 rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-20"
                      />
                    </div>
                  ))}
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        const md = sanitize(composeMarkdownFromState());
                        setSavedMd(md);
                        lastSavedMd.current = md;
                      }}
                      className="h-8 px-3 bg-blue-500/[.1] text-blue-500 text-xs rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Save Education
                    </button>
                  </div>
                </div>

                {/* Skills */}
                <div className="border-b border-black/10 pb-4 mb-4">
                  <h2 className="text-sm font-semibold mb-2">Skills</h2>
                  <textarea
                    value={skills}
                    onChange={(e) => setSkills(e.target.value)}
                    placeholder={"Comma-separated or one per line"}
                    className="w-full rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-24"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        const md = sanitize(composeMarkdownFromState());
                        setSavedMd(md);
                        lastSavedMd.current = md;
                      }}
                      className="h-8 bg-blue-500/[.1] text-blue-500 px-3 text-xs rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Save Skills
                    </button>
                  </div>
                </div>

                {/* Certifications */}
                <div className="border-b border-black/10 pb-4 mb-4">
                  <h2 className="text-sm font-semibold mb-2">Certifications</h2>
                  <textarea
                    value={certifications}
                    onChange={(e) => setCertifications(e.target.value)}
                    className="w-full rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-20"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        const md = sanitize(composeMarkdownFromState());
                        setSavedMd(md);
                        lastSavedMd.current = md;
                      }}
                      className="h-8 px-3 bg-blue-500/[.1] text-blue-500 text-xs rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Save Certifications
                    </button>
                  </div>
                </div>

                {/* Projects / Achievements */}
                <div className="border-b border-black/10 pb-4 mb-4">
                  <h2 className="text-sm font-semibold mb-2">
                    Projects or Achievements
                  </h2>
                  <textarea
                    value={projects}
                    onChange={(e) => setProjects(e.target.value)}
                    className="w-full rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-24"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        const md = sanitize(composeMarkdownFromState());
                        setSavedMd(md);
                        lastSavedMd.current = md;
                      }}
                      className="h-8 px-3 bg-blue-500/[.1] text-blue-500 text-xs rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Save Projects
                    </button>
                  </div>
                </div>

                {/* Languages */}
                <div className="pb-8">
                  <h2 className="text-sm font-semibold mb-2">Languages</h2>
                  <textarea
                    value={languages}
                    onChange={(e) => setLanguages(e.target.value)}
                    className="w-full rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-20"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => {
                        const md = sanitize(composeMarkdownFromState());
                        setSavedMd(md);
                        lastSavedMd.current = md;
                      }}
                      className="h-8 px-3 bg-blue-500/[.1] text-blue-500 text-xs rounded-md border border-black/10 hover:bg-black/5"
                    >
                      Save Languages
                    </button>
                  </div>
                </div>

                <div className="sticky pt-4 bottom-0 left-0 right-0 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-t border-black/10 py-3">
                  <div className="text-xs text-black/60 px-1">
                    Use the Save buttons to update the preview. Download from
                    the right panel.
                  </div>
                </div>
              </div>
            )}
          </main>

          {/* Preview */}
          <aside className="lg:col-span-5">
            <div className="sticky top-4 h-[calc(100vh-6rem)] px-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3 pt-6">
                <h2 className="text-base font-medium">Preview</h2>
                {(editMode ? savedMd : result) && (
                  <button
                    onClick={downloadPdf}
                    className="h-8 px-2.5 inline-flex items-center justify-center text-xs rounded-md border border-black/10 hover:bg-black/5"
                  >
                    Download PDF
                  </button>
                )}
              </div>
              <div className="rounded-2xl border border-black/[.08] bg-white p-6 sm:p-8 h-full shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_30px_rgba(0,0,0,0.06)] overflow-hidden">
                {(editMode ? savedMd : result) ? (
                  <div
                    className="h-full overflow-auto leading-relaxed text-sm prose prose-neutral max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: mdToHtml(editMode ? savedMd : result),
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center">
                    <div className="text-center">
                      <img
                        src="/logo.svg"
                        alt="Preview icon"
                        className="h-16 w-16 mx-auto"
                      />
                      <div className="text-lg font-semibold mb-1">
                        Answer the prompts
                      </div>
                      <div className="text-sm text-black/60">
                        Fill in the fields on the left, then Generate.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {toast.show && (
        <div
          className="fixed bottom-4 right-4 z-50 rounded-md bg-black text-white text-sm px-3 py-2 shadow-lg"
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
