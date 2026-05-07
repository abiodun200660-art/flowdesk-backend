const express = require("express");
const router = express.Router();
const {
  getMyWorkspaces, getWorkspace, createWorkspace, updateWorkspace,
  deleteWorkspace, inviteMember, acceptInvite, removeMember,
} = require("../controllers/workspace.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect);

router.get("/", getMyWorkspaces);
router.post("/", createWorkspace);
router.post("/accept-invite", acceptInvite);
router.get("/:id", getWorkspace);
router.put("/:id", updateWorkspace);
router.delete("/:id", deleteWorkspace);
router.post("/:id/invite", inviteMember);
router.delete("/:id/members/:userId", removeMember);

module.exports = router;
