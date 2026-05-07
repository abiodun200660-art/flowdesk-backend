const mongoose = require("mongoose");

const timeEntrySchema = new mongoose.Schema(
  {
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
    },
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number, // in seconds
      default: 0,
    },
    description: {
      type: String,
      default: "",
      maxlength: 500,
    },
    isBillable: {
      type: Boolean,
      default: true,
    },
    isRunning: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

timeEntrySchema.index({ workspace: 1, user: 1 });
timeEntrySchema.index({ task: 1 });

module.exports = mongoose.model("TimeEntry", timeEntrySchema);
