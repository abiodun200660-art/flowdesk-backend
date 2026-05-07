const Notification = require("../models/Notification.model");
const Workspace = require("../models/Workspace.model");

// @route GET /api/notifications?workspace=xxx
const getNotifications = async (req, res, next) => {
  try {
    const { workspace, unreadOnly } = req.query;
    if (!workspace) {
      return res.status(400).json({ success: false, message: "Workspace ID is required." });
    }

    const filter = { recipient: req.user._id, workspace };
    if (unreadOnly === "true") filter.isRead = false;

    const notifications = await Notification.find(filter)
      .populate("sender", "name avatar")
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({ recipient: req.user._id, workspace, isRead: false });

    res.status(200).json({ success: true, notifications, unreadCount });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/notifications/:id/read
const markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }

    res.status(200).json({ success: true, notification });
  } catch (error) {
    next(error);
  }
};

// @route PUT /api/notifications/read-all
const markAllAsRead = async (req, res, next) => {
  try {
    const { workspace } = req.body;
    await Notification.updateMany(
      { recipient: req.user._id, workspace, isRead: false },
      { isRead: true }
    );
    res.status(200).json({ success: true, message: "All notifications marked as read." });
  } catch (error) {
    next(error);
  }
};

// @route DELETE /api/notifications/:id
const deleteNotification = async (req, res, next) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user._id });
    res.status(200).json({ success: true, message: "Notification deleted." });
  } catch (error) {
    next(error);
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead, deleteNotification };
