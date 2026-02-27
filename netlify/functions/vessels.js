// vessels.js — Server-side proxy for aisstream.io WebSocket
// Browser WebSocket connections are rejected by aisstream.io (Origin check).
// This function connects server-side, collects military vessel positions
// for a few seconds, and returns them as JSON for the client to poll.

const WebSocket = require('ws');

const WS_URL = 'wss://stream.aisstream.io/v0/stream';
const COLLECT_MS = 4000; // collect data for 4 seconds
const MIL_MMSI_PREFIXES = ['3669', '232', '233', '273', '412', '413'];

function isMilitary(mmsi, shipType) {
  if (shipType === 35) return true;
  const s = String(mmsi);
  return MIL_MMSI_PREFIXES.some(p => s.startsWith(p));
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=15',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const API_KEY = process.env.AISSTREAM_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'AISSTREAM_API_KEY not configured' }),
    };
  }

  try {
    const vessels = await collectVessels(API_KEY);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(vessels),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function collectVessels(apiKey) {
  return new Promise((resolve, reject) => {
    const vessels = new Map();
    let ws;

    const timeout = setTimeout(() => {
      if (ws) ws.close();
      resolve(Array.from(vessels.values()));
    }, COLLECT_MS);

    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      clearTimeout(timeout);
      reject(new Error('WebSocket creation failed: ' + err.message));
      return;
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport'],
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (!msg.MetaData || !msg.Message || !msg.Message.PositionReport) return;

        const meta = msg.MetaData;
        const pos = msg.Message.PositionReport;
        const mmsi = meta.MMSI;

        if (!mmsi || meta.latitude == null || meta.longitude == null) return;
        if (meta.latitude === 91 || meta.longitude === 181) return;
        if (!isMilitary(mmsi, meta.ShipType || pos.ShipType)) return;

        vessels.set(mmsi, {
          mmsi,
          name: (meta.ShipName || '').trim(),
          lat: meta.latitude,
          lon: meta.longitude,
          speed: pos.Sog != null ? pos.Sog : null,
          course: pos.Cog != null ? pos.Cog : null,
          heading: pos.TrueHeading != null && pos.TrueHeading !== 511 ? pos.TrueHeading : null,
          status: pos.NavigationalStatus != null ? pos.NavigationalStatus : null,
        });
      } catch { /* skip malformed messages */ }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error('WebSocket error: ' + err.message));
    });

    ws.on('close', (code) => {
      // If closed before timeout, resolve with what we have
      clearTimeout(timeout);
      resolve(Array.from(vessels.values()));
    });
  });
}
