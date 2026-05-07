const express = require("express");
const router = express.Router();
const { generateTasks, getWeeklySummary } = require("../controllers/ai.controller");
const { protect } = require("../middleware/auth.middleware");
const { aiLimiter } = require("../middleware/rateLimit.middleware");

router.use(protect);

router.post("/generate-tasks", aiLimiter, generateTasks);
router.get("/weekly-summary", aiLimiter, getWeeklySummary);

module.exports = router;
