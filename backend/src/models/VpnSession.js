const mongoose = require('mongoose');

const vpnSessionSchema = new mongoose.Schema(
  {
    server: { type: mongoose.Schema.Types.ObjectId, ref: 'VpnServer', required: true },
    label: { type: String, default: '' },
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    clientIp: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VpnSession', vpnSessionSchema);
