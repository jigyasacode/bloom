import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

await mkdir(DATA_DIR, { recursive: true });

const filePath = (user) =>
  join(DATA_DIR, `${user.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);

const empty = () => ({ habits: [], logs: {}, tasks: [], jobs: [] });

async function readUser(user) {
  try {
    return JSON.parse(await readFile(filePath(user), "utf-8"));
  } catch {
    return empty();
  }
}

async function writeUser(user, data) {
  await writeFile(filePath(user), JSON.stringify(data, null, 2), "utf-8");
}

/* ── Existing routes ── */

app.get("/api/:user", async (req, res) => {
  res.json(await readUser(req.params.user));
});

app.put("/api/:user", async (req, res) => {
  await writeUser(req.params.user, req.body);
  res.json({ ok: true });
});

app.post("/api/:user/logs/:date/:habitId", async (req, res) => {
  const { user, date, habitId } = req.params;
  const data = await readUser(user);

  if (!data.logs[date]) data.logs[date] = [];

  data.logs[date] = data.logs[date].includes(habitId)
    ? data.logs[date].filter((id) => id !== habitId)
    : [...data.logs[date], habitId];

  await writeUser(user, data);
  res.json(data.logs);
});

app.patch("/api/:user/tasks/:id", async (req, res) => {
  const data = await readUser(req.params.user);

  data.tasks = data.tasks.map((t) =>
    t.id === req.params.id ? { ...t, ...req.body } : t
  );

  await writeUser(req.params.user, data);
  res.json({ ok: true });
});

/* ── Gemini AI Assistant route ── */

app.post("/api/ai/chat", async (req, res) => {
  const { message, userData } = req.body;

  const today = new Date().toISOString().split("T")[0];

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });

  const { habits = [], logs = {}, tasks = [], jobs = [] } = userData || {};

  const todayDone = (logs[today] || []).length;
  const habitNames = habits.map((h) => h.name).join(", ") || "none";

  const weeklyHabitSummary = last7
    .map((d) => {
      const done = (logs[d] || []).length;
      return `${d}: ${done}/${habits.length} habits`;
    })
    .join("\n");

  const taskSummary =
    tasks
      .map(
        (t) =>
          `- "${t.title}" [${t.status}] category:${t.category || "none"} timeSpent:${Math.round(
            (t.timeSpent || 0) / 60
          )}min${t.dueDate ? " due:" + t.dueDate : ""}`
      )
      .join("\n") || "No tasks.";

  const jobSummary =
    jobs
      .map(
        (j) =>
          `- ${j.company} | ${j.role || "No role"} | ${j.status}${
            j.notes ? " | " + j.notes : ""
          }`
      )
      .join("\n") || "No job applications.";

  const prompt = `
You are Bloom AI, a warm and helpful productivity assistant inside the Bloom app.

Use the user's real data below and answer in a friendly, concise way.
Use headings and bullet points where useful.

=== USER DATA ===

Today: ${today}

Habits (${habits.length} total): ${habitNames}
Today's habit completion: ${todayDone}/${habits.length}

Weekly habit log:
${weeklyHabitSummary}

Tasks:
${taskSummary}

Job applications:
${jobSummary}

=== USER QUESTION ===
${message}
`;

  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Missing GEMINI_API_KEY. Add it in your .env file.",
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.json({
      reply: response.text || "Sorry, I could not generate a reply.",
    });
  } catch (err) {
    console.error("Gemini error:", err);
    res.status(500).json({
      error: "Gemini AI failed. Check your API key or free quota.",
    });
  }
});

/* ── SPA fallback ── */

app.get(/^\/(?!api).*/, (_, res) =>
  res.sendFile(join(__dirname, "index.html"))
);

app.listen(4000, () => {
  console.log("🚀 Bloom + Gemini AI running → http://localhost:4000");
});