const cron = require("node-cron");
const Task = require("../models/Task.model");

const startRecurringTasksCron = () => {
  // Run every day at midnight
  cron.schedule("0 0 * * *", async () => {
    console.log("[CRON] Processing recurring tasks...");
    try {
      const now = new Date();

      // Find completed recurring tasks whose next due date has passed
      const recurringTasks = await Task.find({
        isRecurring: true,
        status: "completed",
        nextDueDate: { $lte: now },
      });

      let created = 0;

      for (const task of recurringTasks) {
        // Calculate next due date
        let nextDate = new Date(task.nextDueDate);
        switch (task.recurringFrequency) {
          case "daily":
            nextDate.setDate(nextDate.getDate() + 1);
            break;
          case "weekly":
            nextDate.setDate(nextDate.getDate() + 7);
            break;
          case "monthly":
            nextDate.setMonth(nextDate.getMonth() + 1);
            break;
          default:
            continue;
        }

        // Create new task
        await Task.create({
          title: task.title,
          description: task.description,
          workspace: task.workspace,
          project: task.project,
          status: "todo",
          priority: task.priority,
          assignedTo: task.assignedTo,
          createdBy: task.createdBy,
          labels: task.labels,
          estimatedHours: task.estimatedHours,
          dueDate: nextDate,
          isRecurring: true,
          recurringFrequency: task.recurringFrequency,
          nextDueDate: nextDate,
          parentTask: task._id,
        });

        // Update the original task's nextDueDate
        task.nextDueDate = nextDate;
        await task.save();

        created++;
      }

      console.log(`[CRON] Created ${created} recurring tasks.`);
    } catch (error) {
      console.error("[CRON] Recurring tasks error:", error.message);
    }
  });

  console.log("[CRON] Recurring tasks scheduler started.");
};

module.exports = startRecurringTasksCron;
