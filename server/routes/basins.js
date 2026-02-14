const express = require('express');

module.exports = (state, hydro) => {
  const router = express.Router();

  // GET /api/basins - Todas las cuencas con estado actual
  router.get('/', (req, res) => {
    const basins = Array.from(state.basins.values()).map(b => ({
      id: b.id,
      name: b.name,
      type: b.type,
      area: b.area,
      controlPoint: b.controlPoint,
      bounds: b.bounds,
      thresholds: b.thresholds,
      currentFlow: b.currentFlow,
      precipitation: b.precipitation,
      intensity: b.intensity,
      subcatchmentCount: (b.subcatchments || []).length,
      alerts: b.alerts,
      hydroResult: b.hydroResult ? {
        method: b.hydroResult.method,
        peakFlow: b.hydroResult.peakFlow,
        peakTime: b.hydroResult.peakTime,
        subcatchmentResults: b.hydroResult.subcatchmentResults
      } : null
    }));
    res.json(basins);
  });

  // GET /api/basins/:id - Cuenca especifica con detalle completo
  router.get('/:id', (req, res) => {
    const basin = state.basins.get(req.params.id);
    if (!basin) return res.status(404).json({ error: 'Cuenca no encontrada' });
    res.json({
      ...basin,
      subcatchments: (basin.subcatchments || []).map(sub => ({
        id: sub.id,
        name: sub.name,
        area: sub.area,
        cn: sub.cn,
        slope: sub.slope,
        tc: sub.tc,
        bounds: sub.bounds,
        center: sub.center,
        routingToOutlet: sub.routingToOutlet
      }))
    });
  });

  // GET /api/basins/:id/hydrograph - Hidrograma compuesto
  router.get('/:id/hydrograph', (req, res) => {
    const basin = state.basins.get(req.params.id);
    if (!basin) return res.status(404).json({ error: 'Cuenca no encontrada' });
    if (!basin.hydroResult) return res.json({ hydrograph: [], message: 'Sin datos hidrologicos' });
    res.json({
      basinId: basin.id,
      method: basin.hydroResult.method,
      peakFlow: basin.hydroResult.peakFlow,
      peakTime: basin.hydroResult.peakTime,
      hydrograph: basin.hydroResult.compositeHydrograph,
      subcatchmentResults: basin.hydroResult.subcatchmentResults
    });
  });

  // GET /api/basins/:id/subcatchments - Detalle de subcuencas
  router.get('/:id/subcatchments', (req, res) => {
    const basin = state.basins.get(req.params.id);
    if (!basin) return res.status(404).json({ error: 'Cuenca no encontrada' });
    const subs = (basin.subcatchments || []).map(sub => {
      const hydroSub = basin.hydroResult?.subcatchmentResults?.find(sr => sr.subId === sub.id);
      return {
        ...sub,
        currentPrecip: hydroSub?.precipitation || 0,
        currentIntensity: hydroSub?.intensity || 0,
        peakFlow: hydroSub?.peakFlow || 0,
        routedPeak: hydroSub?.routedPeak || 0,
        effectiveRainfall: hydroSub?.effectiveRainfall || 0
      };
    });
    res.json(subs);
  });

  return router;
};
