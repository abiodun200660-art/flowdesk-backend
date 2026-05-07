const express = require("express");
const router = express.Router();
const { startTimer, stopTimer, getTimeEntries, updateTimeEntry, deleteTimeEntry, getRunningTimer, exportTimesheetCSV, exportTimesheetPDF } = require("../controllers/timeEntry.controller");
const { protect } = require("../middleware/auth.middleware");

router.use(protect);

router.get("/", getTimeEntries);
router.get("/running", getRunningTimer);
router.get("/export/csv", exportTimesheetCSV);
router.get("/export/pdf", exportTimesheetPDF);
router.post("/start", startTimer);
router.put("/:id/stop", stopTimer);
router.put("/:id", updateTimeEntry);
router.delete("/:id", deleteTimeEntry);

module.exports = router;
