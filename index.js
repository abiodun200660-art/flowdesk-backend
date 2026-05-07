require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");
const passport = require("./config/passport");

const connectDB = require("./config/db");
const errorMiddleware = require("./middleware/error.middleware");
const { generalLimiter } = require("./middleware/rateLimit.middleware");

// Routes
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const workspaceRoutes = require("./routes/workspace.routes");
const projectRoutes = require("./routes/project.routes");
const taskRoutes = require("./routes/task.routes");
const timeEntryRoutes = require("./routes/timeEntry.routes");
const aiRoutes = require("./routes/ai.routes");
const analyticsRoutes = require("./routes/analytics.routes");
const notificationRoutes = require("./routes/notification.routes");

// Cron jobs
const startRecurringTasksCron = require("./cron/recurringTasks");
const startEmailDigestCron = require("./cron/emailDigest");

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Presence tracking
const workspacePresence = {};

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.on("join_workspace", (workspaceId) => {
    socket.join(workspaceId);

    if (!workspacePresence[workspaceId]) workspacePresence[workspaceId] = {};
    if (socket.userId) {
      workspacePresence[workspaceId][socket.userId] = socket.id;
      io.to(workspaceId).emit("presence:update", Object.keys(workspacePresence[workspaceId]));
    }
  });

  socket.on("leave_workspace", (workspaceId) => {
    socket.leave(workspaceId);
    if (workspacePresence[workspaceId] && socket.userId) {
      delete workspacePresence[workspaceId][socket.userId];
      io.to(workspaceId).emit("presence:update", Object.keys(workspacePresence[workspaceId]));
    }
  });

  socket.on("set_user", (userId) => {
    socket.userId = userId;
  });

  socket.on("disconnect", () => {
    // Clean up presence
    for (const wid in workspacePresence) {
      if (socket.userId && workspacePresence[wid][socket.userId] === socket.id) {
        delete workspacePresence[wid][socket.userId];
        io.to(wid).emit("presence:update", Object.keys(workspacePresence[wid]));
      }
    }
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// Make io accessible in controllers via req.io
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(passport.initialize());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

app.use(generalLimiter);

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true, message: "FlowDesk API is running.", timestamp: new Date() });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/time-entries", timeEntryRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/notifications", notificationRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
});

// Global error handler
app.use(errorMiddleware);

// Start cron jobs
startRecurringTasksCron();
startEmailDigestCron();

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 FlowDesk server running on port ${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🔗 Health: http://localhost:${PORT}/api/health\n`);
});

module.exports = { app, io };
