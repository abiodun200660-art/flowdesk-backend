const express = require("express");
const router = express.Router();
const { getProjects, getProject, createProject, updateProject, deleteProject } = require("../controllers/project.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect);

router.get("/", getProjects);
router.post("/", createProject);
router.get("/:id", getProject);
router.put("/:id", updateProject);
router.delete("/:id", deleteProject);

module.exports = router;
