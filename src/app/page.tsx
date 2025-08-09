"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function Home() {
  const [form, setForm] = useState({
    name: "",
    jobTitle: "",
    experience: "",
    jobDescription: "",
    creativeScore: "0.8",
    fromFirstName: "",
    fromLastName: "",
    phone: "",
    email: "",
    toFirstName: "",
    toLastName: "",
    company: "",
    department: "",
  });
  const [skillsTags, setSkillsTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ show: boolean; message: string }>({
    show: false,
    message: "",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const addSkill = (tag: string) => {
    const t = tag.trim();
    if (!t) return;
    setSkillsTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
  };
  const removeSkill = (tag: string) => {
    setSkillsTags((prev) => prev.filter((s) => s !== tag));
  };
  const handleSkillKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const input = e.currentTarget;
      addSkill(input.value.replace(/,$/, ""));
      input.value = "";
    } else if (e.key === "Backspace" && e.currentTarget.value === "") {
      // remove last
      setSkillsTags((prev) => prev.slice(0, -1));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult("");
    try {
      const res = await fetch("/api/generate-cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          creativeScore: parseFloat(form.creativeScore || "0.35"),
          skills: skillsTags,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to generate cover letter");
      }
      setResult(
        typeof data.coverLetter === "string"
          ? data.coverLetter
          : JSON.stringify(data.coverLetter)
      );
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
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

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

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
            <div className="flex items-center gap-18 justify-between">
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
                      : "hover:bg-black/[.05]"
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
                  item.active ? "bg-black text-white" : "hover:bg-black/[.05]"
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

      {/* Main area */}
      <div className="flex-1 overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 p-0">
          {/* Main form */}
          <main
            className={
              (sidebarOpen ? "lg:col-span-7 " : "lg:col-span-7 ") +
              "h-[calc(100vh-2rem)] overflow-auto pr-1 bg-gray-50"
            }
          >
            <h1 className="text-xl font-semibold mb-3 px-4 pt-6">
              Generate your cover letter
            </h1>
            <form onSubmit={handleSubmit} className="px-4">
              <div className="space-y-4">
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="jobDescription">
                    Job Description
                  </label>
                  <textarea
                    id="jobDescription"
                    name="jobDescription"
                    value={form.jobDescription}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2 min-h-44"
                    placeholder="Paste the JD here..."
                    required
                    maxLength={1000}
                  />
                  <div className="mt-1 text-xs text-black/60 self-end">
                    {form.jobDescription.length}/1000
                  </div>
                </div>
              </div>

              <div className="flex flex-col">
                <label className="text-sm mb-1">
                  Which skills should be the focus?
                </label>
                <div className="rounded-md border border-black/[.12] bg-white px-2 py-2 min-h-[42px] flex flex-wrap gap-2">
                  {skillsTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-md bg-black/[.06] px-2 py-1 text-xs"
                    >
                      {tag}
                      <button
                        type="button"
                        className="ml-1 hover:text-black/70"
                        onClick={() => removeSkill(tag)}
                        aria-label={`Remove ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    onKeyDown={handleSkillKeyDown}
                    placeholder="Type a skill and press Enter"
                    className="flex-1 min-w-[160px] bg-transparent outline-none text-sm px-2"
                    aria-label="Add skill"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 pt-4">
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="creativeScore">
                    How creative should the output be?
                  </label>
                  <input
                    id="creativeScore"
                    name="creativeScore"
                    value={form.creativeScore}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                    placeholder="e.g. 0.8"
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="experience">
                    Experience Summary
                  </label>
                  <input
                    id="experience"
                    name="experience"
                    value={form.experience}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                    placeholder="8+ years building web apps..."
                  />
                </div>
              </div>

              <div className="gap-4 pt-4 pb-4">
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="jobTitle">
                    Job Title
                  </label>
                  <input
                    id="jobTitle"
                    name="jobTitle"
                    value={form.jobTitle}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                    placeholder="Frontend Engineer"
                    required
                  />
                </div>
              </div>

              <hr className="my-2 border-black/10 pt-4" />
              <div className="text-base font-semibold mb-2">From</div>
              <div className="grid sm:grid-cols-2 gap-4 pb-4">
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="fromFirstName">
                    First name
                  </label>
                  <input
                    id="fromFirstName"
                    name="fromFirstName"
                    value={form.fromFirstName}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="fromLastName">
                    Last name
                  </label>
                  <input
                    id="fromLastName"
                    name="fromLastName"
                    value={form.fromLastName}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="phone">
                    Phone number
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                    placeholder="+1 555 000 0000"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="email">
                    Email address
                  </label>
                  <input
                    id="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                    placeholder="you@email.com"
                  />
                </div>
              </div>

              <hr className="my-2 border-black/10 pt-4" />
              <div className="text-base font-semibold mb-2">To</div>
              <div className="grid sm:grid-cols-2 gap-4 pb-4">
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="toFirstName">
                    First name
                  </label>
                  <input
                    id="toFirstName"
                    name="toFirstName"
                    value={form.toFirstName}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="toLastName">
                    Last name
                  </label>
                  <input
                    id="toLastName"
                    name="toLastName"
                    value={form.toLastName}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="company">
                    Company name
                  </label>
                  <input
                    id="company"
                    name="company"
                    value={form.company}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="text-sm mb-1" htmlFor="department">
                    Department
                  </label>
                  <input
                    id="department"
                    name="department"
                    value={form.department}
                    onChange={handleChange}
                    className="rounded-md border border-black/[.12] bg-white px-3 py-2"
                  />
                </div>
              </div>

              {error && <div className="text-red-600 text-sm">{error}</div>}
              <div className="sticky bottom-0 left-0 right-0 border-t border-black/10">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-blue-500/[.1] text-blue-500 py-3 font-medium hover:bg-black/85 disabled:opacity-60"
                >
                  {loading ? "Generating..." : "Generate"}
                </button>
              </div>
            </form>
          </main>

          {/* Right preview/result */}
          <aside className={sidebarOpen ? "lg:col-span-5" : "lg:col-span-5"}>
            <div className="sticky h-[calc(100vh-5rem)] px-4 overflow-auto bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-medium pt-6">Preview</h2>
                </div>
                <div className="flex items-center gap-2">
                  {result && (
                    <button
                      onClick={copyToClipboard}
                      className="h-8 px-2.5 inline-flex items-center justify-center text-xs rounded-md border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                    >
                      Copy
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-black/[.08] bg-white p-6 sm:p-8 h-full shadow-[0_1px_0_rgba(0,0,0,0.04),0_8px_30px_rgba(0,0,0,0.06)] overflow-hidden">
                {result ? (
                  <div className="h-full overflow-auto whitespace-pre-wrap leading-relaxed text-sm">
                    {result}
                  </div>
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
                        Get the best preview results by filling in several
                        inputs on the left.
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
          className="fixed bottom-4 right-4 z-50 rounded-md bg-blue-500/[.1] text-blue-500 text-sm px-3 py-2 shadow-lg"
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
