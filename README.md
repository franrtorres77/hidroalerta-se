# HidroAlerta SE - Sistema de Alerta Temprana de Riadas

Sistema de alerta temprana de riadas para el sureste de Espana, basado en datos reales de la red SUREMET y radar AEMET.

## Caracteristicas

- **Datos en tiempo real** de +1100 estaciones meteorologicas SUREMET
- **Calculos hidrologicos** reconocidos: SCS-CN (NRCS TR-55), Metodo Racional Modificado, Hidrograma Unitario de Clark
- **Radar AEMET**: Conversion reflectividad (dBZ) a precipitacion (mm/h) con relaciones Z-R (Marshall-Palmer, Convectiva)
- **12 cuencas hidrograficas** del sureste: Segura, Guadalentin, Mula, Mundo, Almanzora, Andarax, Vinalopo, Guadalfeo, Nacimiento, Adra, Serpis, Jucar Bajo
- **API REST** interna para futuras apps moviles
- **WebSocket** para actualizaciones en tiempo real
- **Interfaz web** profesional con mapa Leaflet, graficos Chart.js y tema oscuro

## Arquitectura

```
server/
  server.js          # Servidor Express + WebSocket + Cron
  config/basins.json  # Configuracion de 12 cuencas con parametros hidrologicos
  services/
    hydro-engine.js   # Motor hidrologico (SCS-CN, Racional, Clark, Temez)
    suremet-scraper.js # Scraper de datos SUREMET (XML)
    radar-aemet.js    # Conversion radar dBZ -> mm/h
    alert-engine.js   # Evaluacion de alertas por umbrales
  routes/             # API REST endpoints
public/
  index.html          # Frontend SPA (Leaflet + Chart.js)
```

## Instalacion

```bash
cd server
npm install
cp .env.example .env   # Configurar AEMET_API_KEY (opcional)
npm start              # Puerto 3000
```

## API Endpoints

| Endpoint | Descripcion |
|----------|-------------|
| GET /api/stations | Todas las estaciones SUREMET |
| GET /api/stations/:id | Estacion por ID |
| GET /api/basins | Todas las cuencas con estado actual |
| GET /api/basins/:id/hydro | Calculo hidrologico de una cuenca |
| POST /api/hydro/calculate | Calculo manual con parametros |
| GET /api/hydro/methods | Metodos hidrologicos disponibles |
| GET /api/radar | Datos de radar AEMET |
| GET /api/radar/convert?dBZ=35 | Conversion dBZ a mm/h |
| GET /api/alerts | Alertas activas |
| GET /api/alerts/level/:level | Alertas por nivel (red/orange/yellow) |

## Metodos Hidrologicos

- **SCS-CN**: Pe = (P - 0.2S)^2 / (P + 0.8S), donde S = (25400/CN) - 254
- **Racional Modificado**: Q = C * I * A / 3.6 (m3/s)
- **Clark UH**: Hidrograma unitario con tc y coeficiente de almacenamiento
- **Temez (tc)**: tc = 0.3 * (L / S^0.25)^0.76 (horas)
- **Radar Z-R**: Marshall-Palmer (a=200, b=1.6) / Convectiva (a=300, b=1.4)

## Fuentes de Datos

- [SUREMET](https://suremet.es/) - Red de estaciones meteorologicas del sureste peninsular
- [AEMET OpenData](https://opendata.aemet.es/) - Datos radar nacional (requiere API key)

## Licencia

MIT
