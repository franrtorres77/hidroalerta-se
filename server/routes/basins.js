const express = require('express');

module.exports = function(state, hydro) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const basins = Array.from(state.basins.values()).map(b => ({
      id: b.id, name: b.name, area: b.area, cn: b.cn,
      currentFlow: b.currentFlow || 0,
      precipitation: b.precipitation || 0,
      intensity: b.intensity || 0,
      center: b.center, thresholds: b.thresholds
    }));
    res.json({ count: basins.length, basins });
  });

  router.get('/:id', (req, res) => {
    const basin = state.basins.get(req.params.id);
    if (!basin) return res.status(404).json({ error: 'Basin not found' });
    res.json(basin);
  });

  router.get('/:id/hydro', (req, res) => {
    const basin = state.basins.get(req.params.id);
    if (!basin) return res.status(404).json({ error: 'Basin not found' });
    const precip = parseFloat(req.query.precipitation) || basin.precipitation || 0;
    const intensity = parseFloat(req.query.intensity) || basin.intensity || 0;
    const result = hydro.calculateFlow(basin, precip, intensity);
    res.json({ basin: basin.name, ...result });
  });

  return router;
};
