# HidroAlerta SE - Sistema de Alerta Temprana de Riadas

Sistema de alerta temprana de riadas para el sureste de Espana, basado en datos reales de la red SUREMET y radar AEMET.

## Modelo Hidrologico Semi-Distribuido

A diferencia de los modelos agregados que tratan cada cuenca como un bloque unico, HidroAlerta SE implementa un **modelo semi-distribuido** que:

1. **Divide cada cuenca en subcuencas** con parametros hidrologicos propios (CN, pendiente, Tc)
2. **Estima la precipitacion local** de cada subcuenca mediante interpolacion espacial (IDW) + fusion con radar AEMET
3. **Calcula el hidrograma** de cada subcuenca con su lluvia real (SCS-CN + Clark UH)
4. **Propaga cada hidrograma** al punto de control usando transito Muskingum
5. **Superpone los hidrogramas** propagados para obtener el caudal total en el punto de control

Esto permite capturar la variabilidad espacial de la lluvia y el desfase temporal del agua viajando por el cauce.

## Cuencas y Ramblas Monitorizadas

### Cuencas Principales
- **Rio Segura** (18.870 km2) - 7 subcuencas: Cabecera, Mundo, Medio, Mula, Guadalentin, Vega Media, Vega Baja
- **Rio Guadalentin** (3.300 km2) - 4 subcuencas inc. Rambla de Nogalte
- **Rio Almanzora** (2.611 km2) - 4 subcuencas inc. Rambla de Albox
- **Rio Vinalopo** (1.692 km2) - 3 subcuencas: Alto, Medio, Bajo
- **Rio Guadalfeo** (1.300 km2) - 3 subcuencas inc. Sierra Nevada
- **Rio Serpis** (752 km2) - 2 subcuencas: Alcoi-Gandia
- **Rio Adra** (744 km2) - 2 subcuencas
- **Jucar Bajo** (4.600 km2) - 3 subcuencas: Tous, Magro, Ribera

### Ramblas y Arroyos (crecidas subitas)
- **Region de Murcia**: Rambla del Albujon, Benipila, Churra, Abanilla
- **Almeria**: Andarax, Nacimiento, Tabernas, Morales, Carboneras, Rio Aguas
- **Alicante**: Barranco de Bonhigon, Torre (Jijona), Gallinera, Racons, Ovejas
- **Campo de Cartagena**: Miranda, Fuente Alamo, Beal, Albujones (Mar Menor)

## Metodos Hidrologicos

- **SCS-CN (NRCS TR-55)**: Escorrentia efectiva por subcuenca
- **Clark UH**: Hidrograma unitario con curva tiempo-area parabolica
- **Metodo Racional Modificado**: Estimacion de caudal punta
- **Muskingum**: Transito de avenida por tramos de cauce (K, X, reaches)
- **Temez**: Tiempo de concentracion (formula recomendada para Espana)
- **IDW + Conditional Merging**: Fusion radar-estaciones (Sinclair & Pegram, 2005)

## API REST

| Endpoint | Descripcion |
|---|---|
| GET /api/basins | Todas las cuencas con estado actual |
| GET /api/basins/:id | Detalle de cuenca con subcuencas |
| GET /api/basins/:id/hydrograph | Hidrograma compuesto semi-distribuido |
| GET /api/basins/:id/subcatchments | Estado de cada subcuenca |
| GET /api/spatial/basin/:id | Precipitacion por subcuenca |
| GET /api/spatial/summary | Resumen espacial todas cuencas |
| GET /api/stations | Estaciones SUREMET |
| GET /api/radar | Datos radar AEMET |
| GET /api/alerts | Alertas activas |

## Instalacion

```bash
cd server
cp .env.example .env  # Configurar AEMET_API_KEY
npm install
npm start
```

## Tecnologias

- Node.js + Express + WebSocket
- Leaflet (mapa dark theme) + Chart.js (hidrogramas)
- SUREMET XML scraper (1100+ estaciones)
- AEMET OpenData API (radar reflectividad)
