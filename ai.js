// AI ENGINE: talks to Google Gemini using Node's built-in fetch().
// Zero external dependencies. Supports structured JSON outputs for:
// 1. Interview Strategy Reports
// 2. ATS-Friendly Resumes + ATS Score Analyzer
// 3. Cover Letters, Recruiter Cold Emails & Screening Q&As
// 4. Batch Job Match Scoring (for the AI Career Agent)
// 5. Multi-Week Skill Learning Roadmaps with Best Resources
// 6. Interactive JD-Based Mock Interviews with Adaptive Follow-Ups

const { AppError } = require("./errors");

const text = (description) => ({ type: "string", description });
const num = (description) => ({ type: "integer", description });
const list = (items, description) => ({ type: "array", items, description });
const object = (properties) => ({ type: "object", properties, required: Object.keys(properties) });
const asArray = (value) => (Array.isArray(value) ? value : []);
const clamp = (n, min, max) => Math.max(min, Math.min(max, Math.round(Number(n) || 0)));

// ---------- JSON Schemas ----------

const questionSchema = object({
  question: text("The question that may be asked in the interview"),
  intention: text("What the interviewer wants to find out by asking this"),
  answer: text("How to answer well: which points to cover and what approach to take"),
});

const reportSchema = object({
  title: text("The job title this interview is for"),
  matchScore: num("0-100: how well the candidate's profile matches the job"),
  technicalQuestions: list(questionSchema, "About 6 technical questions"),
  behavioralQuestions: list(questionSchema, "About 4 behavioral questions"),
  skillGaps: list(
    object({
      skill: text("A skill the job needs that the candidate seems to lack"),
      severity: { type: "string", enum: ["low", "medium", "high"], description: "How much this gap hurts their chances" },
    }),
    "Skill gaps of the candidate"
  ),
  preparationPlan: list(
    object({
      day: num("Day number, starting from 1"),
      focus: text("Main focus of that day"),
      tasks: list({ type: "string" }, "Concrete tasks for that day"),
    }),
    "A 7-day preparation plan"
  ),
});

const resumeCoreSchema = object({
  fullName: text("Candidate's full name"),
  headline: text("One-line ATS-friendly target role headline, e.g. 'Backend & AI/ML Engineer'"),
  email: text("Email, or empty string if unknown"),
  phone: text("Phone, or empty string if unknown"),
  location: text("City/country, or empty string if unknown"),
  links: list({ type: "string" }, "Profile links such as LinkedIn, GitHub, Portfolio"),
  summary: text("2-3 sentence ATS-optimized professional summary aligned to the job description"),
  skills: list(
    object({ category: text("e.g. Languages, Frameworks, AI/ML, Databases, Cloud & Tools"), items: list({ type: "string" }, "Skills matching JD keywords") }),
    "Skills grouped by clean ATS categories"
  ),
  experience: list(
    object({
      role: text("Job title"),
      company: text("Company name"),
      period: text("e.g. 'Jan 2024 - Present'"),
      bullets: list({ type: "string" }, "2-4 action-verb, impact-focused ATS bullet points"),
    }),
    "Work experience or internships, most recent first"
  ),
  projects: list(
    object({
      name: text("Project name"),
      techStack: text("Comma-separated technologies used"),
      description: text("1-2 achievement-focused sentences highlighting JD-relevant impact"),
      link: text("GitHub or live URL if known, else empty string"),
    }),
    "Relevant projects from resume or GitHub"
  ),
  education: list(
    object({ degree: text("Degree / course"), institution: text("School or college"), period: text("Years") }),
    "Education"
  ),
  certifications: list({ type: "string" }, "Relevant certifications or achievements (may be empty)"),
});

const atsBundleSchema = object({
  title: text("Target job title extracted from the job description"),
  company: text("Company name extracted from JD, or empty string if not stated"),
  atsAnalysis: object({
    overallScore: num("0-100 overall ATS compatibility and JD alignment score"),
    keywordScore: num("0-100 JD keyword coverage score"),
    impactScore: num("0-100 action verb & measurable impact score"),
    structureScore: num("0-100 ATS formatting and clarity score"),
    matchedKeywords: list({ type: "string" }, "Important JD keywords present in the tailored resume"),
    missingKeywords: list({ type: "string" }, "Important JD keywords NOT in candidate background (do not fabricate)"),
    tips: list({ type: "string" }, "3-5 specific, actionable tips to further boost ATS score for this role"),
  }),
  resume: resumeCoreSchema,
});

const outreachSchema = object({
  coverLetter: text("Concise 3-paragraph tailored cover letter using only real candidate facts"),
  coldEmailSubject: text("Short, compelling recruiter cold email subject line"),
  coldEmailBody: text("Short 100-140 word cold email to a hiring manager or recruiter"),
  linkedinNote: text("Under-280-character LinkedIn connection request note"),
  screeningAnswers: list(
    object({
      question: text("Likely application screening question for this role"),
      answer: text("Suggested honest, concise answer tailored to the candidate"),
    }),
    "3 likely application form screening questions and answers"
  ),
});

const batchScoreSchema = object({
  scores: list(
    object({
      externalId: text("Exact externalId of the job being scored"),
      matchScore: num("0-100 match score against the candidate's skills, projects, and target roles"),
      reason: text("One concise sentence explaining why this job is or isn't a strong fit"),
      matchedSkills: list({ type: "string" }, "Up to 5 matching skills"),
      missingSkills: list({ type: "string" }, "Up to 4 missing or gap skills"),
    }),
    "Match score for every job in the input list"
  ),
});

const roadmapSchema = object({
  title: text("Clear title for the learning roadmap"),
  overview: text("2-3 sentence overview of what this roadmap achieves"),
  estimatedWeeks: num("Total estimated weeks"),
  phases: list(
    object({
      phaseNumber: num("1-based phase number"),
      title: text("Phase title, e.g. 'Phase 1: Core Foundations'"),
      duration: text("e.g. 'Weeks 1-2'"),
      goal: text("Concrete milestone achieved at the end of this phase"),
      topics: list({ type: "string" }, "4-6 specific subtopics or skills to master"),
      resources: list(
        object({
          name: text("Resource title (official docs, course, book, YouTube playlist, or practice site)"),
          type: text("Docs | Course | Video | Book | Practice"),
          cost: text("Free | Paid | Freemium"),
          url: text("Well-known official URL (e.g. https://docs.python.org, https://roadmap.sh, https://leetcode.com)"),
          why: text("One short sentence on why this is one of the best resources"),
        }),
        "3-4 curated high-quality learning resources"
      ),
      miniProject: text("Hands-on portfolio project to build in this phase"),
      checkpointQuestion: text("An interview-style question to verify mastery of this phase"),
    }),
    "4-5 structured learning phases"
  ),
});

const mockStartSchema = object({
  title: text("Short job title extracted from the job description"),
  interviewerIntro: text("Warm 2-sentence introduction from the AI interviewer"),
  firstQuestion: text("First tailored interview question based directly on the job description and candidate profile"),
  topic: text("Skill or competency area being tested"),
});

const mockEvalSchema = object({
  score: num("1-10 score for the candidate's answer"),
  strengths: list({ type: "string" }, "2-3 things the candidate did well"),
  improvements: list({ type: "string" }, "2-3 specific gaps or ways to improve"),
  modelAnswer: text("Concise, strong model answer for this question"),
  nextQuestion: text("Next tailored interview question or probing follow-up (empty string if final question)"),
  nextTopic: text("Topic of the next question (empty string if final question)"),
  sessionSummary: object({
    overallScore: num("0-100 overall interview score (populated only when interview finishes, else 0)"),
    verdict: text("Strong Hire | Lean Hire | Needs Practice (when finished, else empty)"),
    topStrengths: list({ type: "string" }, "Top strengths across the session (when finished)"),
    focusAreas: list({ type: "string" }, "Key areas to improve before the real interview (when finished)"),
  }),
});

// ---------- Core Gemini caller ----------

async function askGemini(parts, schema) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    throw new AppError(500, "The server has no GEMINI_API_KEY. Add it to your .env file and restart.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const formats = [
    { responseFormat: { text: { mimeType: "APPLICATION_JSON", schema } } },
    { responseMimeType: "application/json", responseJsonSchema: schema },
  ];

  let response, data;
  for (const generationConfig of formats) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ contents: [{ parts }], generationConfig }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      console.error("Could not reach Gemini:", err.message);
      throw new AppError(502, "Could not reach the AI service. Please try again.");
    }
    data = await response.json().catch(() => ({}));
    if (response.status !== 400) break;
  }

  if (!response.ok) {
    const reason = data?.error?.message || `HTTP ${response.status}`;
    console.error("Gemini error:", response.status, reason);
    if (response.status === 429) {
      throw new AppError(503, "The AI service is busy or out of quota. Please try again in a minute.");
    }
    const detail = process.env.NODE_ENV === "production" ? "" : ` (${reason})`;
    throw new AppError(502, "The AI service returned an error." + detail);
  }

  const answer = (data.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought)
    .map((part) => part.text || "")
    .join("");

  if (!answer) {
    throw new AppError(502, "The AI did not return an answer. Try rewording your input.");
  }
  try {
    return JSON.parse(answer);
  } catch {
    throw new AppError(502, "The AI returned an unreadable answer. Please try again.");
  }
}

function buildParts({ resumePdf, selfDescription, jobDescription, extraContext = "" }, instructions) {
  const parts = [];
  if (resumePdf) {
    parts.push({ inline_data: { mime_type: "application/pdf", data: resumePdf.toString("base64") } });
  }
  const blocks = [
    instructions,
    `Resume PDF: ${resumePdf ? "attached as a PDF." : "not provided."}`,
    `Candidate Profile / Self Description:\n${selfDescription || "(none)"}`,
  ];
  if (extraContext) blocks.push(`Synced GitHub & Career Context:\n${extraContext}`);
  if (jobDescription) blocks.push(`Target Job Description:\n${jobDescription}`);
  parts.push({ text: blocks.join("\n\n") });
  return parts;
}

function normalizeResume(raw = {}) {
  return {
    fullName: String(raw.fullName || ""),
    headline: String(raw.headline || ""),
    email: String(raw.email || ""),
    phone: String(raw.phone || ""),
    location: String(raw.location || ""),
    links: asArray(raw.links).map(String),
    summary: String(raw.summary || ""),
    skills: asArray(raw.skills).map((s) => ({
      category: String(s.category || "Skills"),
      items: asArray(s.items).map(String),
    })),
    experience: asArray(raw.experience).map((e) => ({
      role: String(e.role || ""),
      company: String(e.company || ""),
      period: String(e.period || ""),
      bullets: asArray(e.bullets).map(String),
    })),
    projects: asArray(raw.projects).map((p) => ({
      name: String(p.name || ""),
      techStack: String(p.techStack || ""),
      description: String(p.description || ""),
      link: String(p.link || ""),
    })),
    education: asArray(raw.education).map((e) => ({
      degree: String(e.degree || ""),
      institution: String(e.institution || ""),
      period: String(e.period || ""),
    })),
    certifications: asArray(raw.certifications).map(String),
  };
}

// ---------- 1. Interview Strategy Report ----------

async function generateReport(input) {
  const result = await askGemini(
    buildParts(
      input,
      "You are an expert interview coach. Create a personalised interview preparation report for this candidate and job description. Reference their real skills and projects."
    ),
    reportSchema
  );

  return {
    title: String(result.title || "Untitled Position"),
    matchScore: clamp(result.matchScore, 0, 100),
    technicalQuestions: asArray(result.technicalQuestions),
    behavioralQuestions: asArray(result.behavioralQuestions),
    skillGaps: asArray(result.skillGaps).map((gap) => ({
      skill: String(gap.skill || ""),
      severity: ["low", "medium", "high"].includes(gap.severity) ? gap.severity : "medium",
    })),
    preparationPlan: asArray(result.preparationPlan).map((day, index) => ({
      day: Number(day.day) || index + 1,
      focus: String(day.focus || ""),
      tasks: asArray(day.tasks).map(String),
    })),
  };
}

// ---------- 2. ATS-Friendly Resume + ATS Score Analyzer ----------

async function generateAtsResume(input) {
  const result = await askGemini(
    buildParts(
      input,
      [
        "You are an expert ATS (Applicant Tracking System) resume writer and technical recruiter.",
        "Generate an ATS-friendly, single-column tailored resume AND an honest ATS compatibility score analysis for the target job description.",
        "STRICT FACTUAL RULE: Use ONLY facts found in the candidate's resume PDF, self-description, or synced GitHub/LinkedIn profile. NEVER invent employers, job titles, degrees, dates, metrics, or contact info — leave unknown fields empty.",
        "ATS OPTIMIZATION RULES:",
        "- Naturally mirror exact technical keywords and phrases from the JD ONLY where the candidate actually has that skill or project experience.",
        "- Put missing JD keywords in missingKeywords instead of fabricating them.",
        "- Start every experience/project bullet with a strong action verb and keep bullets concise (1-2 lines), clean, and parser-friendly.",
        "- Group skills into crisp standard ATS categories (e.g., Languages, Frameworks, AI/ML, Databases, Tools).",
      ].join("\n")
    ),
    atsBundleSchema
  );

  const a = result.atsAnalysis || {};
  return {
    title: String(result.title || "Target Role"),
    company: String(result.company || ""),
    atsAnalysis: {
      overallScore: clamp(a.overallScore, 0, 100),
      keywordScore: clamp(a.keywordScore, 0, 100),
      impactScore: clamp(a.impactScore, 0, 100),
      structureScore: clamp(a.structureScore, 0, 100),
      matchedKeywords: asArray(a.matchedKeywords).map(String),
      missingKeywords: asArray(a.missingKeywords).map(String),
      tips: asArray(a.tips).map(String),
    },
    resume: normalizeResume(result.resume),
  };
}

// Backward-compatible wrapper used by /api/interviews/:id/resume
async function generateResume(input) {
  const bundle = await generateAtsResume(input);
  return { ...bundle.resume, atsAnalysis: bundle.atsAnalysis };
}

// ---------- 3. Cover Letter, Cold Email & Screening Q&As ----------

async function generateOutreachPack(input) {
  const result = await askGemini(
    buildParts(
      input,
      [
        "You are a career coach helping a candidate apply for a job.",
        "Write a tailored, human-sounding Cover Letter, a short Recruiter Cold Email, a LinkedIn connection note (<280 chars), and answers to 3 likely application screening questions.",
        "Use ONLY real facts from the candidate's profile/resume/GitHub. Keep tone confident, concise, and free of buzzword fluff.",
      ].join("\n")
    ),
    outreachSchema
  );

  return {
    coverLetter: String(result.coverLetter || ""),
    coldEmailSubject: String(result.coldEmailSubject || ""),
    coldEmailBody: String(result.coldEmailBody || ""),
    linkedinNote: String(result.linkedinNote || ""),
    screeningAnswers: asArray(result.screeningAnswers).map((s) => ({
      question: String(s.question || ""),
      answer: String(s.answer || ""),
    })),
  };
}

// ---------- 4. Batch Job Scoring (AI Career Agent) ----------

async function scoreJobsBatch({ candidateSummary, resumePdf, jobs }) {
  const compactJobs = jobs.map((j) => ({
    externalId: j.externalId,
    title: j.title,
    company: j.company,
    location: j.location,
    workMode: j.workMode,
    description: String(j.description || "").slice(0, 900),
  }));

  const parts = [];
  if (resumePdf) {
    parts.push({ inline_data: { mime_type: "application/pdf", data: resumePdf.toString("base64") } });
  }
  parts.push({
    text: [
      "You are an AI Career Agent evaluating live job postings for a candidate.",
      "Score EVERY job in the JSON list from 0 to 100 based on skill overlap, role/field relevance, experience level fit, and GitHub/resume alignment.",
      "Return the exact externalId for each job.",
      `Candidate Profile:\n${candidateSummary || "(see attached resume)"}`,
      `Jobs to evaluate:\n${JSON.stringify(compactJobs)}`,
    ].join("\n\n"),
  });

  const result = await askGemini(parts, batchScoreSchema);
  return asArray(result.scores);
}

// ---------- 5. Skill Learning Roadmaps with Best Resources ----------

async function generateRoadmap({ targetRole, currentSkills, jobDescription, level = "intermediate", weeks = 8, extraContext = "" }) {
  const parts = [
    {
      text: [
        "You are a senior engineering mentor designing a practical, structured skill learning roadmap.",
        `Target Goal / Role: ${targetRole}`,
        `Current Level: ${level}`,
        `Timeframe: ${weeks} weeks`,
        `Current Skills: ${currentSkills || "(not specified)"}`,
        extraContext ? `Synced GitHub / Profile Context:\n${extraContext}` : "",
        jobDescription ? `Target Job Description to bridge gaps for:\n${jobDescription}` : "",
        "Create 4-5 progressive phases. For each phase, recommend 3-4 genuinely well-known, high-quality resources (official documentation, top free courses like CS50/Fast.ai/FullStackOpen/roadmap.sh/MDN/freeCodeCamp, respected books, or practice platforms like LeetCode/Kaggle) with real official URLs, a concrete portfolio mini-project, and an interview checkpoint question.",
      ].filter(Boolean).join("\n\n"),
    },
  ];

  const result = await askGemini(parts, roadmapSchema);
  return {
    title: String(result.title || `${targetRole} Roadmap`),
    overview: String(result.overview || ""),
    estimatedWeeks: clamp(result.estimatedWeeks || weeks, 1, 52),
    phases: asArray(result.phases).map((p, idx) => ({
      phaseNumber: Number(p.phaseNumber) || idx + 1,
      title: String(p.title || `Phase ${idx + 1}`),
      duration: String(p.duration || ""),
      goal: String(p.goal || ""),
      topics: asArray(p.topics).map(String),
      resources: asArray(p.resources).map((r) => ({
        name: String(r.name || ""),
        type: String(r.type || "Resource"),
        cost: String(r.cost || "Free"),
        url: String(r.url || ""),
        why: String(r.why || ""),
      })),
      miniProject: String(p.miniProject || ""),
      checkpointQuestion: String(p.checkpointQuestion || ""),
    })),
  };
}

// ---------- 6. Interactive JD-Based Mock Interviewer ----------

async function startMockInterview({ jobDescription, interviewType, difficulty, candidateSummary, resumePdf }) {
  const result = await askGemini(
    buildParts(
      { resumePdf, selfDescription: candidateSummary, jobDescription },
      [
        `You are a realistic, encouraging senior interviewer conducting a ${difficulty}-level ${interviewType} interview.`,
        "Read the job description and candidate profile carefully.",
        "Give a brief 2-sentence welcome and ask ONE sharp, specific opening question directly grounded in the job description (and referencing the candidate's background/projects if relevant).",
      ].join("\n")
    ),
    mockStartSchema
  );

  return {
    title: String(result.title || "Mock Interview"),
    interviewerIntro: String(result.interviewerIntro || "Welcome! Let's begin your mock interview."),
    firstQuestion: String(result.firstQuestion || "Tell me about a challenging project relevant to this role."),
    topic: String(result.topic || interviewType),
  };
}

async function evaluateMockAnswer({ jobDescription, interviewType, difficulty, candidateSummary, history, currentQuestion, userAnswer, isFinalQuestion }) {
  const transcript = history
    .map((h, i) => `Q${i + 1} (${h.topic}): ${h.question}\nCandidate Answer: ${h.answer}\nScore: ${h.score}/10`)
    .join("\n\n");

  const parts = [
    {
      text: [
        `You are a senior interviewer conducting a ${difficulty}-level ${interviewType} interview.`,
        `Job Description:\n${jobDescription}`,
        candidateSummary ? `Candidate Profile:\n${candidateSummary}` : "",
        transcript ? `Previous Turns:\n${transcript}` : "",
        `Current Question: ${currentQuestion}`,
        `Candidate's Answer:\n${userAnswer}`,
        isFinalQuestion
          ? "This is the FINAL question. Evaluate the answer fairly (1-10), provide strengths, improvements, and a model answer, leave nextQuestion empty, and populate sessionSummary with an honest overallScore (0-100), verdict, topStrengths, and focusAreas."
          : "Evaluate the answer fairly (1-10), provide strengths, improvements, and a model answer, then ask the NEXT tailored question based on the JD (either a deeper follow-up if the answer was vague, or a new core JD topic not covered yet). Leave sessionSummary.overallScore as 0.",
      ].filter(Boolean).join("\n\n"),
    },
  ];

  const result = await askGemini(parts, mockEvalSchema);
  const sum = result.sessionSummary || {};
  return {
    score: clamp(result.score, 1, 10),
    strengths: asArray(result.strengths).map(String),
    improvements: asArray(result.improvements).map(String),
    modelAnswer: String(result.modelAnswer || ""),
    nextQuestion: isFinalQuestion ? "" : String(result.nextQuestion || ""),
    nextTopic: isFinalQuestion ? "" : String(result.nextTopic || interviewType),
    sessionSummary: isFinalQuestion
      ? {
          overallScore: clamp(sum.overallScore, 0, 100),
          verdict: String(sum.verdict || "Needs Practice"),
          topStrengths: asArray(sum.topStrengths).map(String),
          focusAreas: asArray(sum.focusAreas).map(String),
        }
      : null,
  };
}

module.exports = {
  generateReport,
  generateResume,
  generateAtsResume,
  generateOutreachPack,
  scoreJobsBatch,
  generateRoadmap,
  startMockInterview,
  evaluateMockAnswer,
};
