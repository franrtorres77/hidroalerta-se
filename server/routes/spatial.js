const express = require('express');
const SpatialInterpolator = require('../services/spatial-interpolator');

module.exports = function(state, radar) {
  const router = express.Router();
  const spatial = new SpatialInterpolator();

  // GET /api/spatial/basin/:id - Estimacion espacial de precipitacion en una cuenca
  router.get('/basin/:id', (req, res) => {
    const basin = state.basins.get(req.params.id);
    if (!basin) return res.status(404).json({ error: 'Basin not found' });
    const stations = Array.from(state.stations.values());
    const result = spatial.estimateBasinPrecipitation(basin, stations, radar, state.radarGrid);
    res.json(result);
  });

  // GET /api/spatial/interpolate?lat=37.8&lon=-1.5 - IDW en un punto
  router.get('/interpolate', (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'lat and lon required' });
    const stations = Array.from(state.stations.values());
    const precip = spatial.idw(lat, lon, stations, 'precipitation');
    const intensity = spatial.idw(lat, lon, stations, 'intensity');
    res.json({ lat, lon, precipitation: Math.round(precip * 10) / 10, intensity: Math.round(intensity * 10) / 10, method: 'idw', stationsAvailable: stations.length });
  });

  // GET /api/spatial/grid/:basinId - Grilla de precipitacion interpolada
  router.get('/grid/:basinId', (req, res) => {
    const basin = state.basins.get(req.params.basinId);
    if (!basin) return res.status(404).json({ error: 'Basin not found' });
    const stations = Array.from(state.stations.values());
    const result = spatial.interpolateBasin(basin, stations.filter(s =>
      s.lat >= (basin.bounds.south - 0.15) && s.lat <= (basin.bounds.north + 0.15) &&
      s.lon >= (basin.bounds.west - 0.15) && s.lon <= (basin.bounds.east + 0.15)
    ));
    res.json(result);
  });

  // GET /api/spatial/fusion/:basinId - Fusion radar+estaciones
  router.get('/fusion/:basinId', (req, res) => {
    const basin = state.basins.get(req.params.basinId);
    if (!basin) return res.status(404).json({ error: 'Basin not found' });
    if (!state.radarGrid) return res.json({ message: 'No radar data available, using station-only interpolation', ...spatial.interpolateBasin(basin, Array.from(state.stations.values())) });
    const stations = Array.from(state.stations.values());
    const result = spatial.fuseRadarStations(basin, stations, radar, state.radarGrid);
    res.json(result);
  });

  return router;
};
