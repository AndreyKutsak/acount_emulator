const VpnServer = require('../models/VpnServer');
const VpnSession = require('../models/VpnSession');
const { checkHostPort } = require('../services/pingService');
const { checkAllServersNow } = require('../services/vpnCheckService');

exports.getServers = async (req, res, next) => {
  try {
    const servers = await VpnServer.find().sort({ createdAt: -1 });
    res.json(servers);
  } catch (err) {
    next(err);
  }
};

exports.getServer = async (req, res, next) => {
  try {
    const server = await VpnServer.findById(req.params.id);
    if (!server) return res.status(404).json({ message: 'Server not found' });
    res.json(server);
  } catch (err) {
    next(err);
  }
};

exports.createServer = async (req, res, next) => {
  try {
    const server = await VpnServer.create(req.body);
    res.status(201).json(server);
  } catch (err) {
    next(err);
  }
};

exports.updateServer = async (req, res, next) => {
  try {
    const server = await VpnServer.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!server) return res.status(404).json({ message: 'Server not found' });
    res.json(server);
  } catch (err) {
    next(err);
  }
};

exports.deleteServer = async (req, res, next) => {
  try {
    const server = await VpnServer.findByIdAndDelete(req.params.id);
    if (!server) return res.status(404).json({ message: 'Server not found' });
    await VpnSession.deleteMany({ server: server._id });
    res.json({ message: 'Server deleted' });
  } catch (err) {
    next(err);
  }
};

exports.checkServer = async (req, res, next) => {
  try {
    const server = await VpnServer.findById(req.params.id);
    if (!server) return res.status(404).json({ message: 'Server not found' });

    const isOnline = await checkHostPort(server.host, server.port);
    server.status = isOnline ? 'online' : 'offline';
    server.lastCheckedAt = new Date();
    await server.save();

    res.json(server);
  } catch (err) {
    next(err);
  }
};

exports.checkAllServers = async (req, res, next) => {
  try {
    const results = await checkAllServersNow();
    res.json(results);
  } catch (err) {
    next(err);
  }
};
