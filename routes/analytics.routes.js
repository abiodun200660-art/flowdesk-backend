const express = require("express");
const router = express.Router();
const { getOverview, getCompletionTrend, getTeamPerformance, getProjectVelocity, getActivityHeatmap, exportAnalyticsPDF, exportAnalyticsCSV } = require("../controllers/analytics.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect);

router.get("/overview", getOverview);
router.get("/completion-trend", getCompletionTrend);
router.get("/team-performance", getTeamPerformance);
router.get("/project-velocity", getProjectVelocity);
router.get("/activity-heatmap", getActivityHeatmap);
router.get("/export/csv", exportAnalyticsCSV);
router.get("/export/pdf", exportAnalyticsPDF);

module.exports = router;
