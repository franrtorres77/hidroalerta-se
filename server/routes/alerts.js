const express = require('express');

module.exports = function(state) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ count: state.alerts.length, alerts: state.alerts });
  });

  router.get('/active', (req, res) => {
    const active = state.alerts.filter(a => a.level !== 'green');
    res.json({ count: active.length, alerts: active });
  });

  router.get('/basin/:id', (req, res) => {
    const basinAlerts = state.alerts.filter(a => a.basinId === req.params.id);
    res.json({ count: basinAlerts.length, alerts: basinAlerts });
  });

  router.get('/level/:level', (req, res) => {
    const filtered = state.alerts.filter(a => a.level === req.params.level);
    res.json({ count: filtered.length, alerts: filtered });
  });

  return router;
};
