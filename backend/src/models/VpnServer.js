const mongoose = require('mongoose');

const vpnServerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    host: { type: String, required: true, trim: true },
    port: { type: Number, default: 1194 },
    protocol: {
      type: String,
      enum: ['openvpn', 'wireguard', 'ipsec', 'other'],
      default: 'openvpn',
    },
    location: { type: String, default: '' },
    status: {
      type: String,
      enum: ['online', 'offline', 'unknown'],
      default: 'unknown',
    },
    lastCheckedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VpnServer', vpnServerSchema);
