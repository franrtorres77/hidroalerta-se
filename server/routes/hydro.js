const express = require('express');

module.exports = function(state, hydro) {
  const router = express.Router();

  // POST /api/hydro/calculate - Calculo hidrologico manual
  router.post('/calculate', (req, res) => {
    const { basinId, precipitation, intensity } = req.body;
    const basin = state.basins.get(basinId);
    if (!basin) return res.status(404).json({ error: 'Basin not found' });
    const result = hydro.calculateFlow(basin, precipitation || 0, intensity || 0);
    res.json({ basin: basin.name, ...result });
  });

  // GET /api/hydro/methods - Metodos disponibles
  router.get('/methods', (req, res) => {
    res.json({
      methods: [
        { id: 'scs-cn', name: 'SCS Curve Number (NRCS TR-55)', description: 'Calcula escorrentia efectiva mediante numero de curva' },
        { id: 'rational', name: 'Metodo Racional Modificado', description: 'Q = C*I*A/3.6 para caudal punta' },
        { id: 'clark', name: 'Hidrograma Unitario de Clark', description: 'Genera hidrograma usando tc y coef. almacenamiento' }
      ],
      tcFormula: 'Temez: tc = 0.3*(L/S^0.25)^0.76'
    });
  });

  // GET /api/hydro/tc/:basinId - Tiempo de concentracion
  router.get('/tc/:basinId', (req, res) => {
    const basin = state.basins.get(req.params.basinId);
    if (!basin) return res.status(404).json({ error: 'Basin not found' });
    const tc = hydro.calculateTc(basin);
    res.json({ basin: basin.name, tc, unit: 'hours' });
  });

  return router;
};
