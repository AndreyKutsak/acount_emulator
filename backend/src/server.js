require("dotenv").config();
const app = require("./app");
const connectDB = require("./config/db");
const browserService = require("./services/browserService");
const vpnCheckService = require("./services/vpnCheckService");
const scheduler = require("./services/scheduler");
const telegramAutoComment = require("./services/telegramAutoComment");
const telegramAutoReply = require("./services/telegramAutoReply");
const emulatorService = require("./services/emulatorService");
const TelegramAccount = require("./models/TelegramAccount");

const PORT = process.env.PORT || 5000;
const VPN_CHECK_INTERVAL_MS =
  Number(process.env.VPN_CHECK_INTERVAL_MS) || 5 * 60 * 1000;

connectDB()
  // The old unconditional unique index on phone is replaced by one that ignores
  // empty phones (QR / session logins); syncIndexes drops the old one.
  .then(() => TelegramAccount.syncIndexes())
  .then(() => {
    const server = app.listen(PORT, () =>
      console.log(`Server running on port ${PORT}`),
    );
    vpnCheckService.startScheduledChecks(VPN_CHECK_INTERVAL_MS);
    scheduler.startScheduledChecks();
    telegramAutoComment.start();
    telegramAutoReply.start();

    // Автостарт Android-емулятора (ANDROID_AUTOSTART=true). Із затримкою — щоб
    // ManyFaces (:8000) встиг піднятись, якщо все стартує разом (start-all.bat).
    if (process.env.ANDROID_AUTOSTART === "true") {
      setTimeout(() => {
        emulatorService
          .autostart()
          .then((r) => console.log("[android] autostart:", JSON.stringify(r)))
          .catch((err) =>
            console.warn("[android] autostart failed:", err.message),
          );
      }, 8000);
    }

    const shutdown = async () => {
      vpnCheckService.stopScheduledChecks();
      scheduler.stopScheduledChecks();
      telegramAutoComment.stop();
      telegramAutoReply.stop();
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
