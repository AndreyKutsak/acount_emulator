require("dotenv").config();
const app = require("./app");
const connectDB = require("./config/db");
const browserService = require("./services/browserService");
const vpnCheckService = require("./services/vpnCheckService");
const scheduler = require("./services/scheduler");

const PORT = process.env.PORT || 5000;
const VPN_CHECK_INTERVAL_MS =
  Number(process.env.VPN_CHECK_INTERVAL_MS) || 5 * 60 * 1000;

connectDB()
  .then(() => {
    const server = app.listen(PORT, () =>
      console.log(`Server running on port ${PORT}`),
    );
    vpnCheckService.startScheduledChecks(VPN_CHECK_INTERVAL_MS);
    scheduler.startScheduledChecks();

    const shutdown = async () => {
      vpnCheckService.stopScheduledChecks();
      scheduler.stopScheduledChecks();
      await browserService.closeAllSessions();
      server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  });
