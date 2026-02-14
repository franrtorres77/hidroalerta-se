const express = require('express');

module.exports = (state, spatial, radar) => {
  const router = express.Router();

  // GET /api/spatial/basin/:id - Precipitacion por subcuenca
  router.get('/basin/:id', (req, res) => {
    const basin = state.basins.get(req.params.id);
    if (!basin) return res.status(404).json({ error: 'Cuenca no encontrada' });
    const stations = Array.from(state.stations.values());
    const result = spatial.estimateSubcatchmentPrecip(
      basin, stations, radar, state.radarGrid
    );
    res.json(result);
  });

  // GET /api/spatial/grid/:id - Grilla interpolada de cuenca
  router.get('/grid/:id', (req, res) => {
    const basin = state.basins.get(req.params.id);
    if (!basin) return res.status(404).json({ error: 'Cuenca no encontrada' });
    const stations = Array.from(state.stations.values());
    const result = spatial.interpolateBasin(basin, stations);
    res.json(result);
  });

  // GET /api/spatial/summary - Resumen de todas las cuencas
  router.get('/summary', (req, res) => {
    const summary = [];
    for (const [id, basin] of state.basins) {
      summary.push({
        basinId: id,
        name: basin.name,
        type: basin.type,
        precipitation: basin.precipitation || 0,
        intensity: basin.intensity || 0,
        currentFlow: basin.currentFlow || 0,
        subcatchmentCount: (basin.subcatchments || []).length,
        method: basin.spatialEstimate?.method || 'none'
      });
    }
    res.json(summary);
  });

  return router;
};
