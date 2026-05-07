const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const generateTasksFromGoal = async (goal, projectName = "") => {
  const prompt = `You are a project management assistant. Break down the following goal into actionable tasks.

Goal: ${goal}
${projectName ? `Project: ${projectName}` : ""}

Return ONLY a valid JSON array of tasks. No explanation, no markdown, just the JSON.
Each task object must have:
- title (string, max 100 chars)
- description (string, 1-2 sentences)
- priority ("low" | "medium" | "high" | "critical")
- estimatedHours (number)
- labels (array of strings, max 3)

Example format:
[{"title":"Task title","description":"Short description","priority":"medium","estimatedHours":2,"labels":["design"]}]

Generate 3-8 tasks. Make them specific, actionable, and realistic.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].text.trim();
  // Strip any accidental markdown code fences
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
};

const generateWeeklySummary = async (stats) => {
  const prompt = `You are a productivity coach. Write a concise weekly summary for a team member based on their task stats.

Stats this week:
- Tasks completed: ${stats.completed}
- Tasks in progress: ${stats.inProgress}
- Tasks overdue: ${stats.overdue}
- Upcoming deadlines (next 7 days): ${stats.upcoming}
- Total hours logged: ${stats.hoursLogged}
- Most active project: ${stats.topProject || "N/A"}

Write 3-4 sentences. Be encouraging, specific, and end with one actionable tip. Plain text only, no markdown.`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  return message.content[0].text.trim();
};

module.exports = { generateTasksFromGoal, generateWeeklySummary };
