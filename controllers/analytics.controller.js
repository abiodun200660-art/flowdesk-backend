const Task = require("../models/Task.model");
const TimeEntry = require("../models/TimeEntry.model");
const Project = require("../models/Project.model");
const Workspace = require("../models/Workspace.model");
const mongoose = require("mongoose");
const { Types: { ObjectId } } = mongoose;

const isWorkspaceMember = async (workspaceId, userId) => {
  const workspace = await Workspace.findOne({ _id: workspaceId, "members.user": userId });
  return !!workspace;
};

// @route GET /api/analytics/overview?workspace=xxx
const getOverview = async (req, res, next) => {
  try {
    const { workspace } = req.query;
    if (!workspace || !(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const [totalTasks, completedTasks, inProgressTasks, overdueTasks, totalProjects] = await Promise.all([
      Task.countDocuments({ workspace }),
      Task.countDocuments({ workspace, status: "completed" }),
      Task.countDocuments({ workspace, status: "in-progress" }),
      Task.countDocuments({ workspace, status: { $ne: "completed" }, dueDate: { $lt: new Date() } }),
      Project.countDocuments({ workspace }),
    ]);

    const timeEntries = await TimeEntry.find({ workspace });
    const totalHours = Math.round(timeEntries.reduce((s, e) => s + e.duration, 0) / 3600 * 10) / 10;

    // Workspace member count
    const ws = await Workspace.findById(workspace);
    const memberCount = ws ? ws.members.length : 0;

    res.status(200).json({
      success: true,
      stats: {
        totalTasks,
        completedTasks,
        inProgressTasks,
        overdueTasks,
        totalProjects,
        totalHours,
        memberCount,
        completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/analytics/completion-trend?workspace=xxx&days=30
const getCompletionTrend = async (req, res, next) => {
  try {
    const { workspace, days = 30 } = req.query;
    if (!workspace || !(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const daysNum = parseInt(days);
    const startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const completedTasks = await Task.aggregate([
      { $match: { workspace: new ObjectId(workspace), status: "completed", updatedAt: { $gte: startDate } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({ success: true, data: completedTasks });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/analytics/team-performance?workspace=xxx
const getTeamPerformance = async (req, res, next) => {
  try {
    const { workspace } = req.query;
    if (!workspace || !(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const performance = await Task.aggregate([
      { $match: { workspace: new ObjectId(workspace) } },
      { $unwind: "$assignedTo" },
      {
        $group: {
          _id: "$assignedTo",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
          overdue: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ["$status", "completed"] }, { $lt: ["$dueDate", new Date()] }, { $ne: ["$dueDate", null] }] },
                1, 0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          name: "$user.name",
          avatar: "$user.avatar",
          total: 1,
          completed: 1,
          inProgress: 1,
          overdue: 1,
          completionRate: { $cond: [{ $gt: ["$total", 0] }, { $round: [{ $multiply: [{ $divide: ["$completed", "$total"] }, 100] }, 0] }, 0] },
        },
      },
      { $sort: { completed: -1 } },
    ]);

    res.status(200).json({ success: true, data: performance });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/analytics/project-velocity?workspace=xxx
const getProjectVelocity = async (req, res, next) => {
  try {
    const { workspace } = req.query;
    if (!workspace || !(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const data = await Task.aggregate([
      { $match: { workspace: new ObjectId(workspace), project: { $ne: null } } },
      {
        $group: {
          _id: "$project",
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
          todo: { $sum: { $cond: [{ $eq: ["$status", "todo"] }, 1, 0] } },
        },
      },
      {
        $lookup: { from: "projects", localField: "_id", foreignField: "_id", as: "project" },
      },
      { $unwind: "$project" },
      {
        $project: {
          name: "$project.name",
          color: "$project.color",
          total: 1,
          completed: 1,
          inProgress: 1,
          todo: 1,
        },
      },
      { $sort: { total: -1 } },
    ]);

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/analytics/activity-heatmap?workspace=xxx&userId=xxx
const getActivityHeatmap = async (req, res, next) => {
  try {
    const { workspace, userId } = req.query;
    if (!workspace || !(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    const matchUser = userId ? new mongoose.Types.ObjectId(userId) : req.user._id;

    const data = await Task.aggregate([
      {
        $match: {
          workspace: new ObjectId(workspace),
          assignedTo: matchUser,
          status: "completed",
          updatedAt: { $gte: yearAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$updatedAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/analytics/export/csv?workspace=xxx&days=30
// Exports analytics summary as a CSV file
const exportAnalyticsCSV = async (req, res, next) => {
  try {
    const { workspace, days = 30 } = req.query;
    if (!workspace || !(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const daysNum = parseInt(days);
    const startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    // Gather all the data we need in parallel
    const [totalTasks, completedTasks, inProgressTasks, overdueTasks, teamPerf, projVelocity] = await Promise.all([
      Task.countDocuments({ workspace }),
      Task.countDocuments({ workspace, status: "completed" }),
      Task.countDocuments({ workspace, status: "in-progress" }),
      Task.countDocuments({ workspace, status: { $ne: "completed" }, dueDate: { $lt: new Date() } }),
      Task.aggregate([
        { $match: { workspace: new ObjectId(workspace) } },
        { $unwind: "$assignedTo" },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          },
        },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
        { $unwind: "$user" },
        { $project: { name: "$user.name", total: 1, completed: 1 } },
        { $sort: { completed: -1 } },
      ]),
      Task.aggregate([
        { $match: { workspace: new ObjectId(workspace), project: { $ne: null } } },
        {
          $group: {
            _id: "$project",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          },
        },
        { $lookup: { from: "projects", localField: "_id", foreignField: "_id", as: "project" } },
        { $unwind: "$project" },
        { $project: { name: "$project.name", total: 1, completed: 1 } },
        { $sort: { total: -1 } },
      ]),
    ]);

    const timeEntries = await TimeEntry.find({ workspace });
    const totalHours = Math.round((timeEntries.reduce((s, e) => s + e.duration, 0) / 3600) * 10) / 10;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    // Build CSV rows
    const rows = [];
    rows.push(["FlowDesk Analytics Export"]);
    rows.push([`Generated: ${new Date().toISOString()}`, `Period: Last ${daysNum} days`]);
    rows.push([]);
    rows.push(["--- Overview ---"]);
    rows.push(["Metric", "Value"]);
    rows.push(["Total Tasks", totalTasks]);
    rows.push(["Completed Tasks", completedTasks]);
    rows.push(["In Progress", inProgressTasks]);
    rows.push(["Overdue", overdueTasks]);
    rows.push(["Completion Rate (%)", completionRate]);
    rows.push(["Total Hours Logged", totalHours]);
    rows.push([]);
    rows.push(["--- Team Performance ---"]);
    rows.push(["Member", "Total Tasks", "Completed"]);
    teamPerf.forEach((m) => rows.push([m.name, m.total, m.completed]));
    rows.push([]);
    rows.push(["--- Project Velocity ---"]);
    rows.push(["Project", "Total Tasks", "Completed"]);
    projVelocity.forEach((p) => rows.push([p.name, p.total, p.completed]));

    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="flowdesk-analytics-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};

// @route GET /api/analytics/export/pdf?workspace=xxx&days=30
// Exports analytics summary as a simple HTML-based PDF via inline styles
// (Pure Node — no puppeteer. Returns an HTML page the browser prints as PDF.)
const exportAnalyticsPDF = async (req, res, next) => {
  try {
    const { workspace, days = 30 } = req.query;
    if (!workspace || !(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const daysNum = parseInt(days);

    const [totalTasks, completedTasks, inProgressTasks, overdueTasks, teamPerf, projVelocity] = await Promise.all([
      Task.countDocuments({ workspace }),
      Task.countDocuments({ workspace, status: "completed" }),
      Task.countDocuments({ workspace, status: "in-progress" }),
      Task.countDocuments({ workspace, status: { $ne: "completed" }, dueDate: { $lt: new Date() } }),
      Task.aggregate([
        { $match: { workspace: new ObjectId(workspace) } },
        { $unwind: "$assignedTo" },
        {
          $group: {
            _id: "$assignedTo",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          },
        },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
        { $unwind: "$user" },
        { $project: { name: "$user.name", total: 1, completed: 1 } },
        { $sort: { completed: -1 } },
      ]),
      Task.aggregate([
        { $match: { workspace: new ObjectId(workspace), project: { $ne: null } } },
        {
          $group: {
            _id: "$project",
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          },
        },
        { $lookup: { from: "projects", localField: "_id", foreignField: "_id", as: "project" } },
        { $unwind: "$project" },
        { $project: { name: "$project.name", total: 1, completed: 1 } },
        { $sort: { total: -1 } },
      ]),
    ]);

    const timeEntries = await TimeEntry.find({ workspace });
    const totalHours = Math.round((timeEntries.reduce((s, e) => s + e.duration, 0) / 3600) * 10) / 10;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const ws = await Workspace.findById(workspace).select("name");

    const teamRows = teamPerf
      .map(
        (m) => `<tr>
        <td>${m.name}</td>
        <td>${m.total}</td>
        <td>${m.completed}</td>
        <td>${m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0}%</td>
      </tr>`
      )
      .join("");

    const projRows = projVelocity
      .map(
        (p) => `<tr>
        <td>${p.name}</td>
        <td>${p.total}</td>
        <td>${p.completed}</td>
        <td>${p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0}%</td>
      </tr>`
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>FlowDesk Analytics Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; padding: 40px; }
    h1 { font-size: 26px; color: #6366f1; margin-bottom: 4px; }
    .meta { font-size: 13px; color: #64748b; margin-bottom: 32px; }
    h2 { font-size: 16px; color: #334155; margin: 28px 0 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .stat-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .stat-card .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #6366f1; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f1f5f9; text-align: left; padding: 10px 12px; font-weight: 600; color: #475569; }
    td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; }
    tr:hover td { background: #f8fafc; }
    .footer { margin-top: 40px; font-size: 11px; color: #94a3b8; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>FlowDesk Analytics Report</h1>
  <p class="meta">Workspace: <strong>${ws ? ws.name : workspace}</strong> &nbsp;|&nbsp; Period: Last ${daysNum} days &nbsp;|&nbsp; Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

  <h2>Overview</h2>
  <div class="stats-grid">
    <div class="stat-card"><div class="label">Total Tasks</div><div class="value">${totalTasks}</div></div>
    <div class="stat-card"><div class="label">Completed</div><div class="value">${completedTasks}</div></div>
    <div class="stat-card"><div class="label">Completion Rate</div><div class="value">${completionRate}%</div></div>
    <div class="stat-card"><div class="label">In Progress</div><div class="value">${inProgressTasks}</div></div>
    <div class="stat-card"><div class="label">Overdue</div><div class="value">${overdueTasks}</div></div>
    <div class="stat-card"><div class="label">Hours Logged</div><div class="value">${totalHours}</div></div>
  </div>

  <h2>Team Performance</h2>
  <table>
    <thead><tr><th>Member</th><th>Total Tasks</th><th>Completed</th><th>Rate</th></tr></thead>
    <tbody>${teamRows || "<tr><td colspan='4'>No data</td></tr>"}</tbody>
  </table>

  <h2>Project Velocity</h2>
  <table>
    <thead><tr><th>Project</th><th>Total Tasks</th><th>Completed</th><th>Rate</th></tr></thead>
    <tbody>${projRows || "<tr><td colspan='4'>No data</td></tr>"}</tbody>
  </table>

  <div class="footer">FlowDesk &mdash; Generated automatically. Open in browser and use File &rarr; Print &rarr; Save as PDF.</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Disposition", `inline; filename="flowdesk-analytics-${Date.now()}.html"`);
    res.status(200).send(html);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOverview,
  getCompletionTrend,
  getTeamPerformance,
  getProjectVelocity,
  getActivityHeatmap,
  exportAnalyticsPDF,
  exportAnalyticsCSV,
};
