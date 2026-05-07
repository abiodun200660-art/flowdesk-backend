const cron = require("node-cron");
const User = require("../models/User.model");
const Task = require("../models/Task.model");
const TimeEntry = require("../models/TimeEntry.model");
const { generateWeeklySummary } = require("../utils/ai");
const { sendWeeklyDigestEmail } = require("../utils/email");

const startEmailDigestCron = () => {
  // Every Monday at 8am
  cron.schedule("0 8 * * 1", async () => {
    console.log("[CRON] Sending weekly digests...");
    try {
      const users = await User.find({ "preferences.weeklyDigest": true }).select("name email currentWorkspace");
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const now = new Date();

      let sent = 0;

      for (const user of users) {
        if (!user.currentWorkspace) continue;

        try {
          const workspace = user.currentWorkspace;

          const [completed, inProgress, overdue, upcoming] = await Promise.all([
            Task.countDocuments({ workspace, assignedTo: user._id, status: "completed", updatedAt: { $gte: weekAgo } }),
            Task.countDocuments({ workspace, assignedTo: user._id, status: "in-progress" }),
            Task.countDocuments({ workspace, assignedTo: user._id, status: { $ne: "completed" }, dueDate: { $lt: now } }),
            Task.countDocuments({ workspace, assignedTo: user._id, status: { $ne: "completed" }, dueDate: { $gte: now, $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } }),
          ]);

          const timeEntries = await TimeEntry.find({ workspace, user: user._id, startTime: { $gte: weekAgo } });
          const hoursLogged = Math.round(timeEntries.reduce((s, e) => s + e.duration, 0) / 3600 * 10) / 10;

          if (completed === 0 && inProgress === 0) continue; // Skip inactive users

          const summaryText = await generateWeeklySummary({ completed, inProgress, overdue, upcoming, hoursLogged, topProject: null });
          await sendWeeklyDigestEmail(user.email, user.name, summaryText);
          sent++;
        } catch (userError) {
          console.error(`[CRON] Digest failed for ${user.email}:`, userError.message);
        }
      }

      console.log(`[CRON] Sent ${sent} weekly digests.`);
    } catch (error) {
      console.error("[CRON] Email digest error:", error.message);
    }
  });

  console.log("[CRON] Email digest scheduler started.");
};

module.exports = startEmailDigestCron;
