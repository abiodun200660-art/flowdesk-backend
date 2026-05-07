const Project = require("../models/Project.model");
const Task = require("../models/Task.model");
const Workspace = require("../models/Workspace.model");

const isWorkspaceMember = async (workspaceId, userId) => {
  const workspace = await Workspace.findOne({ _id: workspaceId, "members.user": userId });
  return !!workspace;
};

// @route GET /api/projects?workspace=xxx
const getProjects = async (req, res, next) => {
  try {
    const { workspace } = req.query;
    if (!workspace) {
      return res.status(400).json({ success: false, message: "Workspace ID is required." });
    }

    if (!(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const projects = await Project.find({ workspace })
      .populate("owner", "name avatar")
      .populate("members", "name avatar")
      .sort({ order: 1, createdAt: -1 });

    // Get task counts per project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => {
        const taskCount = await Task.countDocuments({ project: project._id });
        const completedCount = await Task.countDocuments({ project: project._id, status: "completed" });
        const obj = project.toObject();
        obj.taskCount = taskCount;
        obj.completionPercentage = taskCount > 0 ? Math.round((completedCount / taskCount) * 100) : 0;
        return obj;
      })
    );

    res.status(200).json({ success: true, projects: projectsWithCounts });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/projects/:id
const getProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("owner", "name avatar")
      .populate("members", "name avatar email");

    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    if (!(await isWorkspaceMember(project.workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    res.status(200).json({ success: true, project });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/projects
const createProject = async (req, res, next) => {
  try {
    const { name, description, workspace, color, startDate, deadline, priority } = req.body;

    if (!name || !workspace) {
      return res.status(400).json({ success: false, message: "Name and workspace are required." });
    }

    if (!(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const project = await Project.create({
      name,
      description,
      workspace,
      owner: req.user._id,
      color: color || "#6366f1",
      startDate,
      deadline,
      priority: priority || "medium",
      members: [req.user._id],
    });

    await project.populate("owner", "name avatar");

    // Emit socket event
    if (req.io) {
      req.io.to(workspace).emit("project:created", project);
    }

    res.status(201).json({ success: true, project });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/projects/:id
const updateProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    if (!(await isWorkspaceMember(project.workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const updatable = ["name", "description", "color", "startDate", "deadline", "status", "priority", "order"];
    updatable.forEach((field) => {
      if (req.body[field] !== undefined) project[field] = req.body[field];
    });

    await project.save();

    if (req.io) {
      req.io.to(project.workspace.toString()).emit("project:updated", project);
    }

    res.status(200).json({ success: true, project });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/projects/:id
const deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found." });
    }

    if (project.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Only the project owner can delete it." });
    }

    // Update tasks to remove project reference
    await Task.updateMany({ project: project._id }, { $unset: { project: "" } });

    await project.deleteOne();

    if (req.io) {
      req.io.to(project.workspace.toString()).emit("project:deleted", { projectId: project._id });
    }

    res.status(200).json({ success: true, message: "Project deleted." });
  } catch (error) {
    next(error);
  }
};

module.exports = { getProjects, getProject, createProject, updateProject, deleteProject };
