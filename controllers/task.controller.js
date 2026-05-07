const Task = require("../models/Task.model");
const Workspace = require("../models/Workspace.model");
const Notification = require("../models/Notification.model");
const cloudinary = require("../config/cloudinary");
const APIFeatures = require("../utils/apiFeatures");

const isWorkspaceMember = async (workspaceId, userId) => {
  const workspace = await Workspace.findOne({ _id: workspaceId, "members.user": userId });
  return !!workspace;
};

const createNotification = async ({ recipient, sender, workspace, type, title, message, link, relatedTask, io }) => {
  if (recipient.toString() === sender.toString()) return;
  const notification = await Notification.create({ recipient, sender, workspace, type, title, message, link, relatedTask });
  if (io) {
    io.to(workspace.toString()).emit("notification:new", { ...notification.toObject(), recipient });
  }
};

// @route GET /api/tasks?workspace=xxx&project=xxx&status=xxx&assignedTo=xxx&search=xxx&sort=xxx&page=x&limit=x
const getTasks = async (req, res, next) => {
  try {
    const { workspace } = req.query;

    if (!workspace) {
      return res.status(400).json({ success: false, message: "Workspace ID is required." });
    }

    if (!(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // Build base query scoped to this workspace
    const baseQuery = Task.find({ workspace })
      .populate("assignedTo", "name avatar")
      .populate("createdBy", "name avatar")
      .populate("project", "name color");

    // Use APIFeatures for filter / search / sort / paginate
    const features = new APIFeatures(baseQuery, req.query)
      .filter()
      .search(["title", "description"])
      .sort()
      .limitFields()
      .paginate();

    const tasks = await features.query;

    // Total count (without pagination) for the frontend
    const totalFeatures = new APIFeatures(Task.find({ workspace }), req.query).filter().search(["title", "description"]);
    const total = await Task.countDocuments(totalFeatures.query.getFilter());

    res.status(200).json({ success: true, total, tasks });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/tasks/:id
const getTask = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate("assignedTo", "name avatar email")
      .populate("createdBy", "name avatar")
      .populate("project", "name color")
      .populate("comments.user", "name avatar");

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    if (!(await isWorkspaceMember(task.workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    res.status(200).json({ success: true, task });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/tasks
const createTask = async (req, res, next) => {
  try {
    const {
      title, description, workspace, project, status, priority,
      assignedTo, dueDate, labels, estimatedHours, isRecurring, recurringFrequency,
    } = req.body;

    if (!title || !workspace) {
      return res.status(400).json({ success: false, message: "Title and workspace are required." });
    }

    if (!(await isWorkspaceMember(workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const task = await Task.create({
      title, description, workspace, project, createdBy: req.user._id,
      status: status || "todo",
      priority: priority || "medium",
      assignedTo: assignedTo || [],
      dueDate, labels: labels || [],
      estimatedHours: estimatedHours || 0,
      isRecurring: isRecurring || false,
      recurringFrequency: recurringFrequency || null,
      nextDueDate: dueDate || null,
    });

    await task.populate([
      { path: "assignedTo", select: "name avatar" },
      { path: "createdBy", select: "name avatar" },
      { path: "project", select: "name color" },
    ]);

    // Send notifications to assigned users
    if (assignedTo && assignedTo.length > 0) {
      for (const userId of assignedTo) {
        await createNotification({
          recipient: userId,
          sender: req.user._id,
          workspace,
          type: "task_assigned",
          title: "New task assigned",
          message: `${req.user.name} assigned you: "${title}"`,
          link: `/dashboard/tasks?task=${task._id}`,
          relatedTask: task._id,
          io: req.io,
        });
      }
    }

    if (req.io) {
      req.io.to(workspace).emit("task:created", task);
    }

    res.status(201).json({ success: true, task });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/tasks/:id
const updateTask = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    if (!(await isWorkspaceMember(task.workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    const oldAssignees = task.assignedTo.map((id) => id.toString());

    const updatable = [
      "title", "description", "status", "priority", "assignedTo",
      "dueDate", "labels", "estimatedHours", "order", "isRecurring",
      "recurringFrequency", "nextDueDate", "project",
    ];
    updatable.forEach((field) => {
      if (req.body[field] !== undefined) task[field] = req.body[field];
    });

    await task.save();
    await task.populate([
      { path: "assignedTo", select: "name avatar" },
      { path: "createdBy", select: "name avatar" },
      { path: "project", select: "name color" },
    ]);

    // Notify newly assigned users
    if (req.body.assignedTo) {
      const newAssignees = req.body.assignedTo.map((id) => id.toString());
      const addedUsers = newAssignees.filter((id) => !oldAssignees.includes(id));
      for (const userId of addedUsers) {
        await createNotification({
          recipient: userId,
          sender: req.user._id,
          workspace: task.workspace,
          type: "task_assigned",
          title: "Task assigned to you",
          message: `${req.user.name} assigned you: "${task.title}"`,
          link: `/dashboard/tasks?task=${task._id}`,
          relatedTask: task._id,
          io: req.io,
        });
      }
    }

    if (req.io) {
      req.io.to(task.workspace.toString()).emit("task:updated", task);
    }

    res.status(200).json({ success: true, task });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/tasks/:id
const deleteTask = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    if (!(await isWorkspaceMember(task.workspace, req.user._id))) {
      return res.status(403).json({ success: false, message: "Access denied." });
    }

    // Delete attachments from cloudinary
    for (const attachment of task.attachments) {
      if (attachment.publicId) {
        await cloudinary.uploader.destroy(attachment.publicId).catch(() => {});
      }
    }

    const workspaceId = task.workspace.toString();
    const taskId = task._id;
    await task.deleteOne();

    if (req.io) {
      req.io.to(workspaceId).emit("task:deleted", { taskId });
    }

    res.status(200).json({ success: true, message: "Task deleted." });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/tasks/:id/comments
const addComment = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, message: "Comment text is required." });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    task.comments.push({ user: req.user._id, text });
    await task.save();
    await task.populate("comments.user", "name avatar");

    const newComment = task.comments[task.comments.length - 1];

    // Notify task creator and assignees
    const notifyUsers = [...task.assignedTo, task.createdBy]
      .map((id) => id.toString())
      .filter((id, idx, arr) => arr.indexOf(id) === idx);

    for (const userId of notifyUsers) {
      await createNotification({
        recipient: userId,
        sender: req.user._id,
        workspace: task.workspace,
        type: "task_commented",
        title: "New comment on task",
        message: `${req.user.name} commented on "${task.title}"`,
        link: `/dashboard/tasks?task=${task._id}`,
        relatedTask: task._id,
        io: req.io,
      });
    }

    if (req.io) {
      req.io.to(task.workspace.toString()).emit("task:comment_added", { taskId: task._id, comment: newComment });
    }

    res.status(201).json({ success: true, comment: newComment });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/tasks/:id/comments/:commentId
const deleteComment = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const comment = task.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found." });
    }

    if (comment.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "You can only delete your own comments." });
    }

    task.comments.pull(req.params.commentId);
    await task.save();

    if (req.io) {
      req.io.to(task.workspace.toString()).emit("task:comment_deleted", { taskId: task._id, commentId: req.params.commentId });
    }

    res.status(200).json({ success: true, message: "Comment deleted." });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/tasks/:id/attachments
const addAttachment = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    task.attachments.push({
      filename: req.file.originalname,
      url: req.file.path,
      publicId: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      uploadedBy: req.user._id,
    });

    await task.save();

    const newAttachment = task.attachments[task.attachments.length - 1];

    if (req.io) {
      req.io.to(task.workspace.toString()).emit("task:attachment_added", { taskId: task._id, attachment: newAttachment });
    }

    res.status(201).json({ success: true, attachment: newAttachment });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/tasks/:id/attachments/:attachmentId
const deleteAttachment = async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    const attachment = task.attachments.id(req.params.attachmentId);
    if (!attachment) {
      return res.status(404).json({ success: false, message: "Attachment not found." });
    }

    if (attachment.publicId) {
      await cloudinary.uploader.destroy(attachment.publicId, { resource_type: "auto" }).catch(() => {});
    }

    task.attachments.pull(req.params.attachmentId);
    await task.save();

    res.status(200).json({ success: true, message: "Attachment deleted." });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  addComment,
  deleteComment,
  addAttachment,
  deleteAttachment,
};
