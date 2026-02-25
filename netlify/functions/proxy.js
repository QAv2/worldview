// CORS proxy for APIs that don't allow browser requests
// Usage: /.netlify/functions/proxy?url=https://celestrak.org/...

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const targetUrl = event.queryStringParameters?.url;
  if (!targetUrl) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing ?url= parameter' }),
    };
  }

  // Allowlist of domains we'll proxy
  const allowed = [
    'celestrak.org',
    'api.adsb.lol',
    'opensky-network.org',
  ];

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid URL' }),
    };
  }

  if (!allowed.some(d => parsed.hostname.endsWith(d))) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Domain not in allowlist' }),
    };
  }

  try {
    const resp = await fetch(targetUrl, {
      headers: { 'User-Agent': 'WorldView-Intel-Globe/1.0' },
    });
    const body = await resp.text();
    return {
      statusCode: resp.status,
      headers: {
        ...headers,
        'Content-Type': resp.headers.get('content-type') || 'application/json',
        'Cache-Control': 'public, max-age=120',
      },
      body,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
