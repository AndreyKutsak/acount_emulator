const VpnSession = require('../models/VpnSession');
const VpnServer = require('../models/VpnServer');

exports.getAllSessions = async (req, res, next) => {
  try {
    const sessions = await VpnSession.find()
      .populate('server', 'name host location')
      .sort({ startedAt: -1 });
    res.json(sessions);
  } catch (err) {
    next(err);
  }
};

exports.getSessionsForServer = async (req, res, next) => {
  try {
    const sessions = await VpnSession.find({ server: req.params.serverId }).sort({
      startedAt: -1,
    });
    res.json(sessions);
  } catch (err) {
    next(err);
  }
};

exports.createSession = async (req, res, next) => {
  try {
    const server = await VpnServer.findById(req.params.serverId);
    if (!server) return res.status(404).json({ message: 'Server not found' });

    const session = await VpnSession.create({
      server: server._id,
      label: req.body.label || '',
      clientIp: req.body.clientIp || '',
      notes: req.body.notes || '',
    });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
};

exports.closeSession = async (req, res, next) => {
  try {
    const session = await VpnSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (session.status === 'closed') {
      return res.status(400).json({ message: 'Session already closed' });
    }
    session.status = 'closed';
    session.endedAt = new Date();
    await session.save();
    res.json(session);
  } catch (err) {
    next(err);
  }
};

exports.deleteSession = async (req, res, next) => {
  try {
    const session = await VpnSession.findByIdAndDelete(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    res.json({ message: 'Session deleted' });
  } catch (err) {
    next(err);
  }
};
