// config.js — Serves client-safe API keys at runtime
// Avoids baking keys into static files (triggers Netlify secret scanner)

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
      maptilerApiKey: process.env.MAPTILER_API_KEY || '',
    }),
  };
};
