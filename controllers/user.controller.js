const User = require("../models/User.model");
const cloudinary = require("../config/cloudinary");

// @route GET /api/users/profile
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate("currentWorkspace", "name color logo");
    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/users/profile
const updateProfile = async (req, res, next) => {
  try {
    const { name, preferences } = req.body;
    const updateData = {};

    if (name) updateData.name = name;
    if (preferences) updateData.preferences = { ...req.user.preferences, ...preferences };

    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/users/password
const updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Both current and new password are required." });
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user.password) {
      return res.status(400).json({ success: false, message: "Cannot update password for OAuth accounts." });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    next(error);
  }
};

// @route POST /api/users/avatar
const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded." });
    }

    // Delete old avatar from Cloudinary using stored publicId for reliability
    const currentUser = await User.findById(req.user._id).select("+avatarPublicId");
    if (currentUser.avatarPublicId) {
      await cloudinary.uploader.destroy(currentUser.avatarPublicId).catch(() => {});
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        avatar: req.file.path,
        avatarPublicId: req.file.filename, // multer-storage-cloudinary sets filename = public_id
      },
      { new: true }
    );

    res.status(200).json({ success: true, avatar: user.avatar, user });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/users/workspace
const switchWorkspace = async (req, res, next) => {
  try {
    const { workspaceId } = req.body;
    const Workspace = require("../models/Workspace.model");

    const workspace = await Workspace.findOne({
      _id: workspaceId,
      "members.user": req.user._id,
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace not found or access denied." });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { currentWorkspace: workspaceId },
      { new: true }
    ).populate("currentWorkspace", "name color logo");

    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/users/account
const deleteAccount = async (req, res, next) => {
  try {
    await User.findByIdAndDelete(req.user._id);
    res.cookie("token", "", { expires: new Date(0), httpOnly: true });
    res.status(200).json({ success: true, message: "Account deleted." });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updatePassword,
  uploadAvatar,
  switchWorkspace,
  deleteAccount,
};
