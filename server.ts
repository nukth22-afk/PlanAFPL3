import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '10mb' }));

interface LatLon {
  lat: number;
  lon: number;
}

interface RoutePairRequest {
  id?: string;
  origin: LatLon;
  destination: LatLon;
}

// Calculate straight line distance (Haversine) in meters
function haversineMeters(c1: LatLon, c2: LatLon): number {
  const R = 6371000; // meters
  const dLat = (c2.lat - c1.lat) * Math.PI / 180;
  const dLon = (c2.lon - c1.lon) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(c1.lat * Math.PI / 180) * Math.cos(c2.lat * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Routes API helper for a single pair with 4-second timeout
async function callComputeRoute(origin: LatLon, destination: LatLon, apiKey: string) {
  const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  const body = {
    origin: {
      location: {
        latLng: {
          latitude: origin.lat,
          longitude: origin.lon,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.lat,
          longitude: destination.lon,
        },
      },
    },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000), // 4 seconds max per call
    });

    const status = response.status;
    const data = await response.json().catch(() => ({}));

    if (status === 429 || data?.error?.status === 'RESOURCE_EXHAUSTED') {
      return {
        status: 429,
        error: 'RESOURCE_EXHAUSTED',
        message: data?.error?.message || 'Quota exceeded for Routes API',
      };
    }

    if (status === 403 || status === 401 || data?.error?.status === 'PERMISSION_DENIED' || data?.error?.status === 'UNAUTHENTICATED') {
      return {
        status,
        error: data?.error?.status || 'PERMISSION_DENIED',
        message: data?.error?.message || 'Permission denied for Routes API',
        permanentError: true,
      };
    }

    if (!response.ok) {
      return {
        status,
        error: data?.error?.status || 'ROUTES_API_ERROR',
        message: data?.error?.message || `HTTP error ${status}`,
      };
    }

    const route = data.routes?.[0];
    if (!route) {
      return {
        status: 404,
        error: 'NO_ROUTE_FOUND',
        message: 'No route found between the points',
      };
    }

    let durationSeconds = 0;
    if (typeof route.duration === 'string') {
      durationSeconds = parseInt(route.duration.replace('s', ''), 10) || 0;
    } else if (typeof route.duration === 'number') {
      durationSeconds = route.duration;
    }

    return {
      status: 200,
      distanceMeters: route.distanceMeters || 0,
      durationSeconds,
      polyline: route.polyline?.encodedPolyline || '',
      source: 'google_maps',
    };
  } catch (err: any) {
    return {
      status: 504,
      error: 'TIMEOUT_OR_NETWORK_ERROR',
      message: err?.message || 'Request timeout',
    };
  }
}

// Fallback estimation using realistic Bangkok road circuity (1.35x) and average speed (22 km/h in traffic)
function fallbackEstimate(origin: LatLon, destination: LatLon) {
  const directMeters = haversineMeters(origin, destination);
  const roadMeters = Math.round(directMeters * 1.35);
  // Average city driving speed: 22 km/h = 6.11 m/s
  const durationSeconds = Math.round(roadMeters / 6.11) + 120; // +2 mins for intersections/stops
  return {
    status: 200,
    distanceMeters: roadMeters,
    durationSeconds,
    polyline: '',
    source: 'fallback_estimate',
  };
}

// Single route calculation endpoint
app.post('/api/routes/compute', async (req: Request, res: Response) => {
  try {
    const { origin, destination } = req.body;
    if (!origin || !destination || origin.lat == null || origin.lon == null || destination.lat == null || destination.lon == null) {
      return res.status(400).json({ error: 'Origin and destination coordinates are required' });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || (req.headers['x-goog-api-key'] as string);

    if (apiKey) {
      const result = await callComputeRoute(origin, destination, apiKey);
      if (result.status === 429) {
        return res.status(429).json(result);
      }
      if (result.status === 200) {
        return res.json(result);
      }
      const fallback = fallbackEstimate(origin, destination);
      return res.json({
        ...fallback,
        apiWarning: result.message,
      });
    }

    const fallback = fallbackEstimate(origin, destination);
    return res.json(fallback);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Server internal error' });
  }
});

// Batch route calculation endpoint with concurrency and fast failover
app.post('/api/routes/batch', async (req: Request, res: Response) => {
  try {
    const { pairs } = req.body as { pairs: RoutePairRequest[] };
    if (!Array.isArray(pairs) || pairs.length === 0) {
      return res.status(400).json({ error: 'pairs array is required' });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || (req.headers['x-goog-api-key'] as string);
    const results: Record<string, any> = {};
    let quotaExceeded = false;
    let apiDisabledOrDenied = false;

    // Process in parallel chunks of 5 concurrent requests
    const CHUNK_SIZE = 5;
    for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
      const chunk = pairs.slice(i, i + CHUNK_SIZE);

      await Promise.all(
        chunk.map(async (p) => {
          const key = p.id || `${p.origin.lat.toFixed(5)},${p.origin.lon.toFixed(5)}->${p.destination.lat.toFixed(5)},${p.destination.lon.toFixed(5)}`;

          if (quotaExceeded || apiDisabledOrDenied || !apiKey) {
            results[key] = {
              ...fallbackEstimate(p.origin, p.destination),
              quotaExceeded,
              apiDisabled: apiDisabledOrDenied,
            };
            return;
          }

          try {
            const resSingle = await callComputeRoute(p.origin, p.destination, apiKey);
            if (resSingle.status === 429) {
              quotaExceeded = true;
              results[key] = {
                ...fallbackEstimate(p.origin, p.destination),
                quotaExceeded: true,
                error: 'RESOURCE_EXHAUSTED',
              };
            } else if ((resSingle as any).permanentError) {
              apiDisabledOrDenied = true;
              results[key] = {
                ...fallbackEstimate(p.origin, p.destination),
                apiWarning: resSingle.message,
                source: 'fallback_estimate',
              };
            } else if (resSingle.status === 200) {
              results[key] = resSingle;
            } else {
              results[key] = {
                ...fallbackEstimate(p.origin, p.destination),
                apiWarning: resSingle.message,
              };
            }
          } catch {
            results[key] = fallbackEstimate(p.origin, p.destination);
          }
        })
      );
    }

    return res.json({
      results,
      quotaExceeded,
      apiDisabled: apiDisabledOrDenied,
      hasApiKey: Boolean(apiKey),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Server internal error' });
  }
});

// Check status endpoint
app.get('/api/routes/status', (_req: Request, res: Response) => {
  const hasKey = Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY);
  res.json({
    status: 'ok',
    hasKey,
    attribution: 'gmp_mcp_codeassist_v1_aistudio',
  });
});

// Maps client config endpoint
app.get('/api/maps/config', (_req: Request, res: Response) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
  res.json({
    apiKey,
    attribution: 'gmp_mcp_codeassist_v1_aistudio',
  });
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
