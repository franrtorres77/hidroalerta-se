const express = require('express');

module.exports = function(state) {
  const router = express.Router();

  // GET /api/stations - Todas las estaciones
  router.get('/', (req, res) => {
    const stations = Array.from(state.stations.values());
    const { province, online } = req.query;
    let filtered = stations;
    if (province) filtered = filtered.filter(s => s.province === province);
    if (online !== undefined) filtered = filtered.filter(s => s.online === (online === 'true'));
    res.json({ count: filtered.length, stations: filtered, lastUpdate: state.lastUpdate });
  });

  // GET /api/stations/:id - Estacion por ID
  router.get('/:id', (req, res) => {
    const station = state.stations.get(req.params.id);
    if (!station) return res.status(404).json({ error: 'Station not found' });
    res.json(station);
  });

  // GET /api/stations/province/:code
  router.get('/province/:code', (req, res) => {
    const stations = Array.from(state.stations.values()).filter(s => s.province === req.params.code.toUpperCase());
    res.json({ count: stations.length, stations });
  });

  return router;
};
