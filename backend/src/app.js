const path = require("path");
const express = require("express");
const cors = require("cors");
const itemRoutes = require("./routes/itemRoutes");
const vpnServerRoutes = require("./routes/vpnServerRoutes");
const vpnSessionRoutes = require("./routes/vpnSessionRoutes");
const socialAccountRoutes = require("./routes/socialAccountRoutes");
const postRoutes = require("./routes/postRoutes");
const automationRoutes = require("./routes/automationRoutes");
const threadsCommentRoutes = require("./routes/threadsCommentRoutes");
const statsRoutes = require("./routes/statsRoutes");
const schedulerRoutes = require("./routes/schedulerRoutes");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/items", itemRoutes);
app.use("/api/vpn-servers", vpnServerRoutes);
app.use("/api/vpn-sessions", vpnSessionRoutes);
app.use("/api/social-accounts", socialAccountRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/automation", automationRoutes);
app.use("/api/threads-comments", threadsCommentRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/scheduler", schedulerRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
