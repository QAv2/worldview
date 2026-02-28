#!/bin/bash
# Inject API keys into globe.js at build time
sed -i "s/__GOOGLE_MAPS_API_KEY__/${GOOGLE_MAPS_API_KEY}/g" js/globe.js 2>/dev/null
sed -i "s/__MAPTILER_API_KEY__/${MAPTILER_API_KEY}/g" js/globe.js 2>/dev/null
echo "Build complete"
