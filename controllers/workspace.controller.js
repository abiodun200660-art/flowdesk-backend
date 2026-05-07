const crypto = require("crypto");
const Workspace = require("../models/Workspace.model");
const User = require("../models/User.model");
const { sendWorkspaceInviteEmail } = require("../utils/email");

// @route GET /api/workspaces
const getMyWorkspaces = async (req, res, next) => {
  try {
    const workspaces = await Workspace.find({ "members.user": req.user._id }).populate("owner", "name avatar");
    res.status(200).json({ success: true, workspaces });
  } catch (error) {
    next(error);
  }
};

// @route GET /api/workspaces/:id
const getWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findOne({
      _id: req.params.id,
      "members.user": req.user._id,
    })
      .populate("owner", "name avatar email")
      .populate("members.user", "name avatar email");

    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found." });
    }

    res.status(200).json({ success: true, workspace });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/workspaces
const createWorkspace = async (req, res, next) => {
  try {
    const { name, description, color } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Workspace name is required." });
    }

    const workspace = await Workspace.create({
      name,
      description,
      color: color || "#6366f1",
      owner: req.user._id,
      members: [{ user: req.user._id, role: "admin" }],
    });

    res.status(201).json({ success: true, workspace });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/workspaces/:id
// Only workspace admins can update settings
const updateWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findOne({
      _id: req.params.id,
      "members.user": req.user._id,
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found." });
    }

    const member = workspace.members.find((m) => m.user.toString() === req.user._id.toString());
    if (!member || member.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only admins can update workspace settings." });
    }

    const { name, description, color } = req.body;
    if (name) workspace.name = name;
    if (description !== undefined) workspace.description = description;
    if (color) workspace.color = color;

    await workspace.save();
    res.status(200).json({ success: true, workspace });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/workspaces/:id
// Only the workspace owner can delete it
const deleteWorkspace = async (req, res, next) => {
  try {
    const workspace = await Workspace.findOne({ _id: req.params.id, owner: req.user._id });

    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found or you are not the owner." });
    }

    await workspace.deleteOne();
    res.status(200).json({ success: true, message: "Workspace deleted." });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/workspaces/:id/invite
// Only workspace admins can invite members
const inviteMember = async (req, res, next) => {
  try {
    const { email, role } = req.body;
    const workspace = await Workspace.findOne({
      _id: req.params.id,
      "members.user": req.user._id,
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found." });
    }

    const requester = workspace.members.find((m) => m.user.toString() === req.user._id.toString());
    if (!requester || requester.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only admins can invite members." });
    }

    // Check if already a member
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const alreadyMember = workspace.members.some((m) => m.user.toString() === existingUser._id.toString());
      if (alreadyMember) {
        return res.status(400).json({ success: false, message: "User is already a member." });
      }
    }

    const inviteToken = crypto.randomBytes(32).toString("hex");
    workspace.invites.push({
      email,
      role: role || "member",
      token: inviteToken,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
      invitedBy: req.user._id,
    });

    await workspace.save();
    await sendWorkspaceInviteEmail(email, req.user.name, workspace.name, inviteToken);

    res.status(200).json({ success: true, message: `Invitation sent to ${email}.` });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/workspaces/accept-invite
// Authenticated — user must be logged in to accept an invite
const acceptInvite = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: "Invite token is required." });
    }

    const workspace = await Workspace.findOne({ "invites.token": token });
    if (!workspace) {
      return res.status(404).json({ success: false, message: "Invalid or expired invite." });
    }

    const invite = workspace.invites.find((i) => i.token === token);
    if (!invite || invite.expiresAt < Date.now()) {
      return res.status(400).json({ success: false, message: "Invite has expired." });
    }

    // Prevent double-joining
    const alreadyMember = workspace.members.some((m) => m.user.toString() === req.user._id.toString());
    if (alreadyMember) {
      return res.status(400).json({ success: false, message: "You are already a member of this workspace." });
    }

    // Add to workspace members
    workspace.members.push({ user: req.user._id, role: invite.role });
    // Remove the used invite
    workspace.invites = workspace.invites.filter((i) => i.token !== token);
    await workspace.save();

    res.status(200).json({ success: true, workspace });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/workspaces/:id/members/:userId
// Only workspace admins can remove members; owner cannot be removed
const removeMember = async (req, res, next) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found." });
    }

    const requester = workspace.members.find((m) => m.user.toString() === req.user._id.toString());
    if (!requester || requester.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only admins can remove members." });
    }

    if (workspace.owner.toString() === req.params.userId) {
      return res.status(400).json({ success: false, message: "Cannot remove the workspace owner." });
    }

    workspace.members = workspace.members.filter((m) => m.user.toString() !== req.params.userId);
    await workspace.save();

    res.status(200).json({ success: true, message: "Member removed." });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  inviteMember,
  acceptInvite,
  removeMember,
};
