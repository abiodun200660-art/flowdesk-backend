const { verifyToken } = require("../utils/jwt");
const User = require("../models/User.model");

const protect = async (req, res, next) => {
  try {
    let token;

    // Check cookie first, then Authorization header
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authenticated. Please log in." });
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ success: false, message: "User no longer exists." });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "You do not have permission to perform this action." });
    }
    next();
  };
};

// Check if user is workspace admin or owner
const requireWorkspaceAdmin = async (req, res, next) => {
  try {
    const Workspace = require("../models/Workspace.model");
    const workspaceId = req.params.workspaceId || req.body.workspace || req.query.workspace;

    if (!workspaceId) {
      return res.status(400).json({ success: false, message: "Workspace ID is required." });
    }

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found." });
    }

    const member = workspace.members.find((m) => m.user.toString() === req.user._id.toString());
    if (!member || (member.role !== "admin" && workspace.owner.toString() !== req.user._id.toString())) {
      return res.status(403).json({ success: false, message: "Only workspace admins can perform this action." });
    }

    req.workspace = workspace;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { protect, restrictTo, requireWorkspaceAdmin };
