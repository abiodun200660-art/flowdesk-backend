const TimeEntry = require("../models/TimeEntry.model");
const Task = require("../models/Task.model");
const Workspace = require("../models/Workspace.model");

const isWorkspaceMember = async (workspaceId, userId) => {
  const workspace = await Workspace.findOne({ _id: workspaceId, "members.user": userId });
  return !!workspace;
};

// @route POST /api/time-entries/start
const startTimer = async (req, res, next) => {
  try {
    const { taskId, description, isBillable } = req.body;

    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    if (!(await isWorkspaceMember(task.workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // Stop any currently running timer for this user
    await TimeEntry.updateMany(
      { user: req.user._id, isRunning: true },
      { isRunning: false, endTime: new Date() }
    );

    const entry = await TimeEntry.create({
      task: taskId,
      user: req.user._id,
      workspace: task.workspace,
      project: task.project || null,
      startTime: new Date(),
      description: description || "",
      isBillable: isBillable !== undefined ? isBillable : true,
      isRunning: true,
    });

    res.status(201).json({ success: true, entry });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/time-entries/:id/stop
const stopTimer = async (req, res, next) => {
  try {
    const entry = await TimeEntry.findOne({ _id: req.params.id, user: req.user._id });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Time entry not found." });
    }

    const endTime = new Date();
    const duration = Math.floor((endTime - entry.startTime) / 1000); // seconds

    entry.endTime = endTime;
    entry.duration = duration;
    entry.isRunning = false;
    await entry.save();

    await entry.populate([
      { path: "task", select: "title" },
      { path: "project", select: "name color" },
    ]);

    res.status(200).json({ success: true, entry });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/time-entries?workspace=xxx&startDate=xxx&endDate=xxx
const getTimeEntries = async (req, res, next) => {
  try {
    const { workspace, startDate, endDate, taskId, userId } = req.query;

    if (!workspace) {
      return res.status(400).json({ success: false, message: "Workspace ID is required." });
    }

    const ws = await Workspace.findOne({ _id: workspace, "members.user": req.user._id });
    if (!ws) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // Only workspace admins or the owner can view another member's time entries
    if (userId && userId !== req.user._id.toString()) {
      const member = ws.members.find((m) => m.user.toString() === req.user._id.toString());
      const isAdmin = member && member.role === "admin";
      const isOwner = ws.owner.toString() === req.user._id.toString();
      if (!isAdmin && !isOwner) {
        return res.status(403).json({ success: false, message: "Only workspace admins can view other members' time entries." });
      }
    }

    const filter = { workspace, user: userId || req.user._id };
    if (taskId) filter.task = taskId;
    if (startDate || endDate) {
      filter.startTime = {};
      if (startDate) filter.startTime.$gte = new Date(startDate);
      if (endDate) filter.startTime.$lte = new Date(endDate);
    }

    const entries = await TimeEntry.find(filter)
      .populate("task", "title")
      .populate("project", "name color")
      .sort({ startTime: -1 });

    // Calculate total duration
    const totalSeconds = entries.reduce((sum, e) => sum + (e.duration || 0), 0);

    res.status(200).json({ success: true, entries, totalSeconds });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/time-entries/:id
const updateTimeEntry = async (req, res, next) => {
  try {
    const entry = await TimeEntry.findOne({ _id: req.params.id, user: req.user._id });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Time entry not found." });
    }

    const { description, isBillable, startTime, endTime } = req.body;
    if (description !== undefined) entry.description = description;
    if (isBillable !== undefined) entry.isBillable = isBillable;
    if (startTime) entry.startTime = new Date(startTime);
    if (endTime) {
      entry.endTime = new Date(endTime);
      entry.duration = Math.floor((entry.endTime - entry.startTime) / 1000);
      entry.isRunning = false;
    }

    await entry.save();
    res.status(200).json({ success: true, entry });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/time-entries/:id
const deleteTimeEntry = async (req, res, next) => {
  try {
    const entry = await TimeEntry.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Time entry not found." });
    }
    res.status(200).json({ success: true, message: "Time entry deleted." });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/time-entries/running
const getRunningTimer = async (req, res, next) => {
  try {
    const entry = await TimeEntry.findOne({ user: req.user._id, isRunning: true })
      .populate("task", "title")
      .populate("project", "name color");
    res.status(200).json({ success: true, entry: entry || null });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/time-entries/export/csv?workspace=xxx&startDate=xxx&endDate=xxx
const exportTimesheetCSV = async (req, res, next) => {
  try {
    const { workspace, startDate, endDate } = req.query;

    if (!workspace) {
      return res.status(400).json({ success: false, message: "Workspace ID is required." });
    }

    if (!(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const filter = { workspace, user: req.user._id };
    if (startDate || endDate) {
      filter.startTime = {};
      if (startDate) filter.startTime.$gte = new Date(startDate);
      if (endDate) filter.startTime.$lte = new Date(endDate);
    }

    const entries = await TimeEntry.find(filter)
      .populate("task", "title")
      .populate("project", "name")
      .sort({ startTime: 1 });

    const totalSeconds = entries.reduce((sum, e) => sum + (e.duration || 0), 0);
    const totalHours = (totalSeconds / 3600).toFixed(2);

    const rows = [];
    rows.push(["FlowDesk Timesheet Export"]);
    rows.push([`User: ${req.user.name}`, `Exported: ${new Date().toISOString()}`]);
    rows.push([]);
    rows.push(["Date", "Task", "Project", "Description", "Start Time", "End Time", "Duration (h)", "Billable"]);

    entries.forEach((e) => {
      const durationHours = e.duration ? (e.duration / 3600).toFixed(2) : "0.00";
      rows.push([
        e.startTime ? new Date(e.startTime).toLocaleDateString() : "",
        e.task ? e.task.title : "—",
        e.project ? e.project.name : "—",
        e.description || "",
        e.startTime ? new Date(e.startTime).toLocaleTimeString() : "",
        e.endTime ? new Date(e.endTime).toLocaleTimeString() : "Running",
        durationHours,
        e.isBillable ? "Yes" : "No",
      ]);
    });

    rows.push([]);
    rows.push(["", "", "", "", "", "Total Hours:", totalHours, ""]);

    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="flowdesk-timesheet-${Date.now()}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};

// @route GET /api/time-entries/export/pdf?workspace=xxx&startDate=xxx&endDate=xxx
// Returns a print-ready HTML page formatted as a professional timesheet
const exportTimesheetPDF = async (req, res, next) => {
  try {
    const { workspace, startDate, endDate } = req.query;

    if (!workspace) {
      return res.status(400).json({ success: false, message: "Workspace ID is required." });
    }

    if (!(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const filter = { workspace, user: req.user._id };
    if (startDate || endDate) {
      filter.startTime = {};
      if (startDate) filter.startTime.$gte = new Date(startDate);
      if (endDate) filter.startTime.$lte = new Date(endDate);
    }

    const entries = await TimeEntry.find(filter)
      .populate("task", "title")
      .populate("project", "name")
      .sort({ startTime: 1 });

    const totalSeconds = entries.reduce((sum, e) => sum + (e.duration || 0), 0);
    const totalHours = (totalSeconds / 3600).toFixed(2);
    const billableSeconds = entries.filter((e) => e.isBillable).reduce((sum, e) => sum + (e.duration || 0), 0);
    const billableHours = (billableSeconds / 3600).toFixed(2);

    const Workspace = require("../models/Workspace.model");
    const ws = await Workspace.findById(workspace).select("name");

    const entryRows = entries
      .map((e) => {
        const durationHours = e.duration ? (e.duration / 3600).toFixed(2) : "0.00";
        return `<tr>
          <td>${e.startTime ? new Date(e.startTime).toLocaleDateString() : "—"}</td>
          <td>${e.task ? e.task.title : "—"}</td>
          <td>${e.project ? e.project.name : "—"}</td>
          <td>${e.description || ""}</td>
          <td>${e.startTime ? new Date(e.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
          <td>${e.endTime ? new Date(e.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Running"}</td>
          <td style="text-align:right;font-weight:600">${durationHours}h</td>
          <td style="text-align:center">${e.isBillable ? "✓" : ""}</td>
        </tr>`;
      })
      .join("");

    const dateRange =
      startDate || endDate
        ? `${startDate ? new Date(startDate).toLocaleDateString() : "Beginning"} — ${endDate ? new Date(endDate).toLocaleDateString() : "Today"}`
        : "All time";

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>FlowDesk Timesheet</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; padding: 40px; font-size: 13px; }
    header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 3px solid #6366f1; }
    header h1 { font-size: 24px; color: #6366f1; }
    header .meta { font-size: 12px; color: #64748b; line-height: 1.8; text-align: right; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
    .summary-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
    .summary-card .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .summary-card .value { font-size: 24px; font-weight: 700; color: #6366f1; margin-top: 4px; }
    h2 { font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #6366f1; color: white; text-align: left; padding: 10px 10px; font-weight: 600; font-size: 12px; }
    td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tr:nth-child(even) td { background: #f8fafc; }
    tfoot td { background: #1e293b !important; color: white; font-weight: 700; padding: 10px; }
    .footer { margin-top: 32px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 16px; }
    @media print { body { padding: 20px; } @page { margin: 1cm; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Timesheet Report</h1>
      <div style="margin-top:6px;color:#64748b;font-size:13px">FlowDesk &mdash; ${ws ? ws.name : "Workspace"}</div>
    </div>
    <div class="meta">
      <strong>${req.user.name}</strong><br />
      Period: ${dateRange}<br />
      Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
    </div>
  </header>

  <div class="summary">
    <div class="summary-card"><div class="label">Total Entries</div><div class="value">${entries.length}</div></div>
    <div class="summary-card"><div class="label">Total Hours</div><div class="value">${totalHours}h</div></div>
    <div class="summary-card"><div class="label">Billable Hours</div><div class="value">${billableHours}h</div></div>
  </div>

  <h2>Time Entries</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Task</th>
        <th>Project</th>
        <th>Description</th>
        <th>Start</th>
        <th>End</th>
        <th style="text-align:right">Hours</th>
        <th style="text-align:center">Billable</th>
      </tr>
    </thead>
    <tbody>${entryRows || '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:24px">No time entries found for this period.</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="6">Total</td>
        <td style="text-align:right">${totalHours}h</td>
        <td style="text-align:center">${billableHours}h billable</td>
      </tr>
    </tfoot>
  </table>

  <div class="footer">FlowDesk Timesheet &mdash; Open in browser and use File &rarr; Print &rarr; Save as PDF</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html");
    res.setHeader("Content-Disposition", `inline; filename="flowdesk-timesheet-${Date.now()}.html"`);
    res.status(200).send(html);
  } catch (error) {
    next(error);
  }
};

module.exports = { startTimer, stopTimer, getTimeEntries, updateTimeEntry, deleteTimeEntry, getRunningTimer, exportTimesheetCSV, exportTimesheetPDF };
