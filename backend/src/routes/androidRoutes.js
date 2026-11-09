const express = require("express");
const c = require("../controllers/androidController");

const router = express.Router();

// Керування емулятором (через ManyFaces): запуск/зупинка профілю-пристрою
router.get("/emulator/profiles", c.emulatorProfiles);
router.get("/emulator/status", c.emulatorStatus);
router.post("/emulator/start", c.emulatorStart);
router.post("/emulator/stop", c.emulatorStop);

// Стан / інформація
router.get("/health", c.health);
router.get("/devices", c.devices);
router.get("/info", c.info);

// Застосунки
router.post("/app/install", c.installApp);
router.post("/app/start", c.startApp);
router.post("/app/stop", c.stopApp);
router.get("/app/current", c.currentApp);
router.get("/apps", c.listApps);

// Дії на екрані
router.post("/tap-text", c.tapText);
router.post("/tap", c.tap);
router.post("/type", c.type);
router.post("/press", c.press);
router.post("/swipe", c.swipe);

// Поведінки (flows)
router.post("/threads/post", c.threadsPost);

// Оркестрація життєвого циклу: піднятти профіль-телефон → дія → закрити → згасити
router.post("/orchestrate/account", c.orchestrateAccount);
router.post("/orchestrate/queue", c.orchestrateQueue);

// Профіль маскування пристрою (Шар A/Б): редагування й застосування
router.get("/device/defaults", c.deviceDefaults);
router.get("/device/profile", c.deviceProfile);
router.put("/device/profile", c.deviceProfileSave);
router.get("/device/current", c.deviceCurrent);
router.post("/device/apply", c.deviceApply);
router.post("/device/apply-persistent", c.deviceApplyPersistent);

// Медіа: залити фото/відео з ПК у галерею
router.post("/media/push", c.mediaPush);

// Бінарне / дерево
router.get("/screenshot", c.screenshot);
router.get("/hierarchy", c.hierarchy);

module.exports = router;
