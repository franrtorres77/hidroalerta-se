const express = require('express');

module.exports = function(state, radar) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(state.radarData || { message: 'No radar data available' });
  });

  // GET /api/radar/convert?dBZ=35&type=marshall_palmer
  router.get('/convert', (req, res) => {
    const dBZ = parseFloat(req.query.dBZ) || 0;
    const type = req.query.type || 'marshall_palmer';
    const rainRate = radar.dBZtoRainRate(dBZ, type);
    const classification = radar.classifyIntensity(rainRate);
    res.json({ dBZ, type, rainRate: Math.round(rainRate * 100) / 100, classification });
  });

  router.get('/zr-relations', (req, res) => {
    res.json(radar.zrRelations);
  });

  return router;
};
