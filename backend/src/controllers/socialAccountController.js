const SocialAccount = require("../models/SocialAccount");
const { encrypt, decrypt } = require("../services/cryptoService");

function toSafeAccount(account) {
  const obj = account.toObject();
  delete obj.passwordEncrypted;
  // Encrypted threads-bot session cookies — internal reuse only, never sent to the client.
  delete obj.threadsSessionEncrypted;
  // Proxy config may contain provider credentials — never sent to the client.
  delete obj.proxyConfig;
  return obj;
}

exports.getAccounts = async (req, res, next) => {
  try {
    const accounts = await SocialAccount.find()
      .populate("vpnServer", "name host status")
      .sort({ createdAt: -1 });
    res.json(accounts.map(toSafeAccount));
  } catch (err) {
    next(err);
  }
};

exports.getAccount = async (req, res, next) => {
  try {
    const account = await SocialAccount.findById(req.params.id).populate(
      "vpnServer",
      "name host status",
    );
    if (!account) return res.status(404).json({ message: "Account not found" });
    res.json(toSafeAccount(account));
  } catch (err) {
    next(err);
  }
};

exports.createAccount = async (req, res, next) => {
  try {
    const {
      platform,
      displayName,
      username,
      password,
      vpnServer,
      notes,
      userAgent,
      profileId,
      androidProfileId,
      proxyConfig,
    } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "username and password are required" });
    }
    const account = await SocialAccount.create({
      platform,
      displayName,
      username,
      passwordEncrypted: encrypt(password),
      vpnServer: vpnServer || null,
      notes,
      userAgent: userAgent || "",
      profileId: profileId || "windows_chrome",
      androidProfileId: androidProfileId || "",
      proxyConfig: proxyConfig || null,
    });
    res.status(201).json(toSafeAccount(account));
  } catch (err) {
    next(err);
  }
};

exports.updateAccount = async (req, res, next) => {
  try {
    const {
      platform,
      displayName,
      username,
      password,
      vpnServer,
      notes,
      userAgent,
      profileId,
      androidProfileId,
      proxyConfig,
    } = req.body;
    const update = { platform, displayName, username, vpnServer, notes };
    if (userAgent !== undefined) update.userAgent = userAgent;
    if (profileId !== undefined) update.profileId = profileId;
    if (androidProfileId !== undefined) update.androidProfileId = androidProfileId;
    if (proxyConfig !== undefined) update.proxyConfig = proxyConfig;
    if (password) update.passwordEncrypted = encrypt(password);

    const account = await SocialAccount.findByIdAndUpdate(
      req.params.id,
      update,
      {
        new: true,
        runValidators: true,
      },
    );
    if (!account) return res.status(404).json({ message: "Account not found" });
    res.json(toSafeAccount(account));
  } catch (err) {
    next(err);
  }
};

exports.deleteAccount = async (req, res, next) => {
  try {
    const account = await SocialAccount.findByIdAndDelete(req.params.id);
    if (!account) return res.status(404).json({ message: "Account not found" });
    res.json({ message: "Account deleted" });
  } catch (err) {
    next(err);
  }
};

exports.revealPassword = async (req, res, next) => {
  try {
    const account = await SocialAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ message: "Account not found" });
    res.json({ password: decrypt(account.passwordEncrypted) });
  } catch (err) {
    next(err);
  }
};
