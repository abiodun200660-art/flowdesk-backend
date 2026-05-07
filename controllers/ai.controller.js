const { generateTasksFromGoal, generateWeeklySummary } = require("../utils/ai");
const Task = require("../models/Task.model");
const TimeEntry = require("../models/TimeEntry.model");
const Workspace = require("../models/Workspace.model");

const isWorkspaceMember = async (workspaceId, userId) => {
  const workspace = await Workspace.findOne({ _id: workspaceId, "members.user": userId });
  return !!workspace;
};

// @route POST /api/ai/generate-tasks
const generateTasks = async (req, res, next) => {
  try {
    const { goal, projectName, workspace, project, createImmediately } = req.body;

    if (!goal || !workspace) {
      return res.status(400).json({ success: false, message: "Goal and workspace are required." });
    }

    if (!(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const generatedTasks = await generateTasksFromGoal(goal, projectName);

    if (createImmediately) {
      const createdTasks = await Task.insertMany(
        generatedTasks.map((t) => ({
          ...t,
          workspace,
          project: project || null,
          createdBy: req.user._id,
          status: "todo",
        }))
      );

      if (req.io) {
        req.io.to(workspace).emit("tasks:bulk_created", createdTasks);
      }

      return res.status(201).json({ success: true, tasks: createdTasks, message: `${createdTasks.length} tasks created.` });
    }

    // Return preview without creating
    res.status(200).json({ success: true, tasks: generatedTasks });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/ai/weekly-summary?workspace=xxx
const getWeeklySummary = async (req, res, next) => {
  try {
    const { workspace } = req.query;

    if (!workspace) {
      return res.status(400).json({ success: false, message: "Workspace ID is required." });
    }

    if (!(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const [completed, inProgress, overdue, upcoming] = await Promise.all([
      Task.countDocuments({ workspace, assignedTo: req.user._id, status: "completed", updatedAt: { $gte: weekAgo } }),
      Task.countDocuments({ workspace, assignedTo: req.user._id, status: "in-progress" }),
      Task.countDocuments({ workspace, assignedTo: req.user._id, status: { $ne: "completed" }, dueDate: { $lt: now } }),
      Task.countDocuments({ workspace, assignedTo: req.user._id, status: { $ne: "completed" }, dueDate: { $gte: now, $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } }),
    ]);

    // Total hours logged this week
    const timeEntries = await TimeEntry.find({
      workspace,
      user: req.user._id,
      startTime: { $gte: weekAgo },
    });
    const hoursLogged = Math.round(timeEntries.reduce((sum, e) => sum + e.duration, 0) / 3600 * 10) / 10;

    // Most active project
    const projectCounts = {};
    for (const entry of timeEntries) {
      if (entry.project) {
        const key = entry.project.toString();
        projectCounts[key] = (projectCounts[key] || 0) + entry.duration;
      }
    }

    let topProject = null;
    if (Object.keys(projectCounts).length > 0) {
      const topId = Object.entries(projectCounts).sort((a, b) => b[1] - a[1])[0][0];
      const Project = require("../models/Project.model");
      const proj = await Project.findById(topId).select("name");
      topProject = proj ? proj.name : null;
    }

    const summary = await generateWeeklySummary({ completed, inProgress, overdue, upcoming, hoursLogged, topProject });

    res.status(200).json({ success: true, summary, stats: { completed, inProgress, overdue, upcoming, hoursLogged } });
  } catch (error) {
    next(error);
  }
};

module.exports = { generateTasks, getWeeklySummary };
