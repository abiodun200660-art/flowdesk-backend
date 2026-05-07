const express = require("express");
const router = express.Router();
const {
  getTasks, getTask, createTask, updateTask, deleteTask,
  addComment, deleteComment, addAttachment, deleteAttachment,
} = require("../controllers/task.controller");
const { protect } = require("../middleware/auth.middleware");
const { uploadAttachment } = require("../middleware/upload.middleware");

router.use(protect);

router.get("/", getTasks);
router.post("/", createTask);
router.get("/:id", getTask);
router.put("/:id", updateTask);
router.delete("/:id", deleteTask);

// Comments
router.post("/:id/comments", addComment);
router.delete("/:id/comments/:commentId", deleteComment);

// Attachments
router.post("/:id/attachments", uploadAttachment.single("file"), addAttachment);
router.delete("/:id/attachments/:attachmentId", deleteAttachment);

module.exports = router;
