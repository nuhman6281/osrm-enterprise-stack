const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const redis = require("redis");
const axios = require("axios");
const polyline = require("polyline");
const turf = require("@turf/turf");
const NodeCache = require("node-cache");
const winston = require("winston");
// const { serve, setup } = require('./swagger');
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
const OSRM_BACKEND_URL =
  process.env.OSRM_BACKEND_URL || "http://localhost:5000";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Initialize Redis client
let redisClient;
try {
  redisClient = redis.createClient({ url: REDIS_URL });
  redisClient.connect();
  redisClient.on("error", (err) => console.log("Redis Client Error", err));
} catch (error) {
  console.warn("Redis not available, using in-memory cache");
  redisClient = null;
}

// Fallback in-memory cache
const memoryCache = new NodeCache({ stdTTL: 600 }); // 10 minutes

// Logger configuration
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "osrm-enhanced-api" },
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use(limiter);

// Logging
app.use(
  morgan("combined", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// Cache helper functions
async function getFromCache(key) {
  if (redisClient) {
    try {
      const result = await redisClient.get(key);
      return result ? JSON.parse(result) : null;
    } catch (error) {
      logger.error("Redis get error:", error);
      return memoryCache.get(key);
    }
  }
  return memoryCache.get(key);
}

async function setCache(key, value, ttl = 600) {
  if (redisClient) {
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
      logger.error("Redis set error:", error);
      memoryCache.set(key, value, ttl);
    }
  } else {
    memoryCache.set(key, value, ttl);
  }
}

// OSRM API wrapper
class OSRMService {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30000,
      headers: {
        "User-Agent": "OSRM-Enhanced-API/1.0.0",
      },
    });
  }

  async makeRequest(endpoint, params = {}) {
    try {
      const response = await this.client.get(endpoint, { params });
      return response.data;
    } catch (error) {
      logger.error(`OSRM request failed: ${endpoint}`, error.message);
      throw new Error(`OSRM service unavailable: ${error.message}`);
    }
  }

  // Enhanced route service with caching
  async getRoute(coordinates, options = {}) {
    const cacheKey = `route:${JSON.stringify({ coordinates, options })}`;
    const cached = await getFromCache(cacheKey);
    if (cached) return cached;

    const coordString = coordinates.map((c) => `${c.lng},${c.lat}`).join(";");
    const endpoint = `/route/v1/driving/${coordString}`;

    const result = await this.makeRequest(endpoint, {
      overview: options.overview || "full",
      geometries: options.geometries || "polyline",
      steps: options.steps || "true",
      alternatives: options.alternatives || "false",
      ...options,
    });

    await setCache(cacheKey, result, 300); // 5 minutes cache
    return result;
  }

  // Enhanced table service with optimization
  async getTable(sources, destinations, options = {}) {
    const cacheKey = `table:${JSON.stringify({
      sources,
      destinations,
      options,
    })}`;
    const cached = await getFromCache(cacheKey);
    if (cached) return cached;

    const allCoords = [...sources, ...destinations];
    const coordString = allCoords.map((c) => `${c.lng},${c.lat}`).join(";");
    const sourceIndices = sources.map((_, i) => i).join(";");
    const destIndices = destinations
      .map((_, i) => sources.length + i)
      .join(";");

    const endpoint = `/table/v1/driving/${coordString}`;
    const result = await this.makeRequest(endpoint, {
      sources: sourceIndices,
      destinations: destIndices,
      ...options,
    });

    await setCache(cacheKey, result, 600); // 10 minutes cache
    return result;
  }

  // Trip optimization service
  async optimizeTrip(waypoints, options = {}) {
    const cacheKey = `trip:${JSON.stringify({ waypoints, options })}`;
    const cached = await getFromCache(cacheKey);
    if (cached) return cached;

    const coordString = waypoints.map((wp) => `${wp.lng},${wp.lat}`).join(";");
    const endpoint = `/trip/v1/driving/${coordString}`;

    const result = await this.makeRequest(endpoint, {
      roundtrip: options.roundtrip || "false",
      source: options.source || "first",
      destination: options.destination || "last",
      ...options,
    });

    await setCache(cacheKey, result, 300);
    return result;
  }

  // GPS trace matching
  async matchTrace(coordinates, timestamps, options = {}) {
    const coordString = coordinates.map((c) => `${c.lng},${c.lat}`).join(";");
    const timeString = timestamps.join(";");
    const endpoint = `/match/v1/driving/${coordString}`;

    return await this.makeRequest(endpoint, {
      timestamps: timeString,
      overview: options.overview || "full",
      steps: options.steps || "true",
      ...options,
    });
  }

  // Nearest service
  async findNearest(coordinate, options = {}) {
    const cacheKey = `nearest:${coordinate.lng},${
      coordinate.lat
    }:${JSON.stringify(options)}`;
    const cached = await getFromCache(cacheKey);
    if (cached) return cached;

    const endpoint = `/nearest/v1/driving/${coordinate.lng},${coordinate.lat}`;
    const result = await this.makeRequest(endpoint, {
      number: options.number || 1,
      ...options,
    });

    await setCache(cacheKey, result, 300);
    return result;
  }
}

const osrmService = new OSRMService(OSRM_BACKEND_URL);

// Enhanced API Routes

// API Documentation endpoint
app.get("/api-docs", (req, res) => {
  const apiDocs = {
    title: "OSRM Enhanced API",
    version: "1.0.0",
    description:
      "A comprehensive OSRM API with enhanced features including caching, optimization, and analytics",
    baseUrl: `http://localhost:${PORT}`,
    endpoints: [
      {
        method: "GET",
        path: "/health",
        description: "Health check endpoint",
        tags: ["Health"],
        example: `curl 'http://localhost:${PORT}/health'`,
      },
      {
        method: "GET",
        path: "/route",
        description: "Calculate route between waypoints with caching",
        tags: ["Routing"],
        parameters: [
          "waypoints (required): JSON array of coordinates",
          "overview: Route geometry detail (full, simplified, false)",
          "steps: Include turn-by-turn instructions (true, false)",
          "alternatives: Return alternative routes (true, false)",
        ],
        example: `curl 'http://localhost:${PORT}/route?waypoints=[{"lng":13.388860,"lat":52.517037},{"lng":13.397634,"lat":52.529407}]'`,
      },
      {
        method: "POST",
        path: "/matrix",
        description:
          "Calculate distance/duration matrix between multiple points",
        tags: ["Matrix"],
        body: {
          sources: "Array of source coordinates",
          destinations: "Array of destination coordinates",
        },
        example: `curl -X POST http://localhost:${PORT}/matrix -H "Content-Type: application/json" -d '{"sources":[{"lng":13.388860,"lat":52.517037}],"destinations":[{"lng":13.397634,"lat":52.529407}]}'`,
      },
      {
        method: "POST",
        path: "/optimize",
        description: "Optimize trip route (TSP solver)",
        tags: ["Optimization"],
        body: {
          waypoints: "Array of waypoints to optimize",
          roundtrip: "Return to starting point (true, false)",
          source: "Starting waypoint constraint (first, any)",
          destination: "Ending waypoint constraint (last, any)",
        },
        example: `curl -X POST http://localhost:${PORT}/optimize -H "Content-Type: application/json" -d '{"waypoints":[{"lng":13.388860,"lat":52.517037},{"lng":13.397634,"lat":52.529407}]}'`,
      },
      {
        method: "POST",
        path: "/match",
        description: "GPS trace matching to road networks",
        tags: ["Matching"],
        body: {
          coordinates: "Array of GPS coordinates",
          timestamps: "Array of timestamps corresponding to coordinates",
        },
        example: `curl -X POST http://localhost:${PORT}/match -H "Content-Type: application/json" -d '{"coordinates":[{"lng":13.388860,"lat":52.517037}],"timestamps":[1234567890]}'`,
      },
      {
        method: "GET",
        path: "/nearest",
        description: "Find nearest road to a coordinate",
        tags: ["Utilities"],
        parameters: [
          "lat (required): Latitude in decimal degrees",
          "lng (required): Longitude in decimal degrees",
          "number: Number of nearest roads to return (1-10)",
        ],
        example: `curl 'http://localhost:${PORT}/nearest?lat=52.517037&lng=13.388860'`,
      },
      {
        method: "POST",
        path: "/isochrone",
        description: "Isochrone analysis for reachability studies",
        tags: ["Analysis"],
        body: {
          center: "Center coordinate for analysis",
          time_limits:
            "Array of time limits in seconds (default: [300, 600, 900])",
          profile: "Routing profile (default: driving)",
        },
        example: `curl -X POST http://localhost:${PORT}/isochrone -H "Content-Type: application/json" -d '{"center":{"lng":13.388860,"lat":52.517037},"time_limits":[300,600,900]}'`,
      },
      {
        method: "GET",
        path: "/cache/stats",
        description: "Get cache statistics",
        tags: ["Utilities"],
        example: `curl 'http://localhost:${PORT}/cache/stats'`,
      },
      {
        method: "DELETE",
        path: "/cache",
        description: "Clear cache",
        tags: ["Utilities"],
        example: `curl -X DELETE 'http://localhost:${PORT}/cache'`,
      },
    ],
    features: [
      "Redis caching for improved performance",
      "Load balancing with automatic failover",
      "Rate limiting and security headers",
      "Comprehensive logging and monitoring",
      "Enhanced analytics and metadata",
      "GPS trace matching with confidence scoring",
      "Trip optimization (TSP solver)",
      "Isochrone analysis",
      "Distance/duration matrices",
      "Nearest road finding",
    ],
  };

  // Return HTML documentation if browser request, JSON if API request
  const acceptHeader = req.headers.accept || "";
  if (acceptHeader.includes("text/html")) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>OSRM Enhanced API Documentation</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .endpoint { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; margin: 10px 0; padding: 15px; }
        .method { display: inline-block; padding: 4px 8px; border-radius: 3px; color: white; font-weight: bold; margin-right: 10px; }
        .get { background: #28a745; }
        .post { background: #007bff; }
        .delete { background: #dc3545; }
        .path { font-family: monospace; font-size: 16px; font-weight: bold; }
        .example { background: #f1f3f4; padding: 10px; border-radius: 3px; font-family: monospace; font-size: 12px; margin-top: 10px; overflow-x: auto; }
        .features { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .tag { background: #6c757d; color: white; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin-right: 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>${apiDocs.title}</h1>
        <p>${apiDocs.description}</p>
        <p><strong>Version:</strong> ${
          apiDocs.version
        } | <strong>Base URL:</strong> ${apiDocs.baseUrl}</p>
    </div>
    
    <div class="features">
        <h3>🚀 Enhanced Features</h3>
        <ul>
            ${apiDocs.features.map((feature) => `<li>${feature}</li>`).join("")}
        </ul>
    </div>
    
    <h2>📚 API Endpoints</h2>
    ${apiDocs.endpoints
      .map(
        (endpoint) => `
        <div class="endpoint">
            <div>
                <span class="method ${endpoint.method.toLowerCase()}">${
          endpoint.method
        }</span>
                <span class="path">${endpoint.path}</span>
                ${endpoint.tags
                  .map((tag) => `<span class="tag">${tag}</span>`)
                  .join("")}
            </div>
            <p>${endpoint.description}</p>
            ${
              endpoint.parameters
                ? `<p><strong>Parameters:</strong> ${endpoint.parameters.join(
                    ", "
                  )}</p>`
                : ""
            }
            ${
              endpoint.body
                ? `<p><strong>Body:</strong> ${Object.entries(endpoint.body)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(", ")}</p>`
                : ""
            }
            <div class="example">${endpoint.example}</div>
        </div>
    `
      )
      .join("")}
    
    <div style="margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 5px;">
        <h3>🔗 Related Services</h3>
        <ul>
            <li><strong>Standard OSRM API:</strong> <a href="http://localhost:5001">http://localhost:5001</a></li>
            <li><strong>Frontend Interface:</strong> <a href="http://localhost:9966">http://localhost:9966</a></li>
            <li><strong>Grafana Monitoring:</strong> <a href="http://localhost:3000">http://localhost:3000</a></li>
            <li><strong>Prometheus Metrics:</strong> <a href="http://localhost:9090">http://localhost:9090</a></li>
        </ul>
    </div>
</body>
</html>`;
    res.send(html);
  } else {
    res.json(apiDocs);
  }
});

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check endpoint
 *     description: Returns the current health status of the API service
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthStatus'
 */
// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

/**
 * @swagger
 * /route:
 *   get:
 *     tags: [Routing]
 *     summary: Calculate route between waypoints
 *     description: Enhanced route calculation with caching and additional metadata
 *     parameters:
 *       - in: query
 *         name: waypoints
 *         required: true
 *         description: JSON array of coordinate objects
 *         schema:
 *           type: string
 *           example: '[{"lng":13.388860,"lat":52.517037},{"lng":13.397634,"lat":52.529407}]'
 *       - in: query
 *         name: overview
 *         schema:
 *           type: string
 *           enum: [full, simplified, false]
 *           default: full
 *         description: Route geometry detail level
 *       - in: query
 *         name: steps
 *         schema:
 *           type: string
 *           enum: [true, false]
 *           default: true
 *         description: Include turn-by-turn instructions
 *       - in: query
 *         name: alternatives
 *         schema:
 *           type: string
 *           enum: [true, false]
 *           default: false
 *         description: Return alternative routes
 *     responses:
 *       200:
 *         description: Route calculated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Route'
 *                 - type: object
 *                   properties:
 *                     enhanced:
 *                       type: object
 *                       properties:
 *                         cached:
 *                           type: boolean
 *                         processing_time:
 *                           type: number
 *                         api_version:
 *                           type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Enhanced route endpoint
app.get("/route", async (req, res) => {
  try {
    const { waypoints, ...options } = req.query;

    if (!waypoints) {
      return res.status(400).json({ error: "Waypoints parameter is required" });
    }

    const coordinates = JSON.parse(waypoints);
    const result = await osrmService.getRoute(coordinates, options);

    // Add enhanced metadata
    result.enhanced = {
      cached:
        (await getFromCache(
          `route:${JSON.stringify({ coordinates, options })}`
        )) !== null,
      processing_time: Date.now() - req.startTime,
      api_version: "2.0",
    };

    res.json(result);
  } catch (error) {
    logger.error("Route endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /matrix:
 *   post:
 *     tags: [Matrix]
 *     summary: Calculate distance/duration matrix
 *     description: Calculate distances and durations between multiple source and destination points
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sources, destinations]
 *             properties:
 *               sources:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/Coordinate'
 *                 description: Array of source coordinates
 *                 example: [{"lng":13.388860,"lat":52.517037}]
 *               destinations:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/Coordinate'
 *                 description: Array of destination coordinates
 *                 example: [{"lng":13.397634,"lat":52.529407},{"lng":13.428555,"lat":52.523219}]
 *     responses:
 *       200:
 *         description: Matrix calculated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Matrix'
 *                 - type: object
 *                   properties:
 *                     analytics:
 *                       type: object
 *                       properties:
 *                         total_combinations:
 *                           type: number
 *                         processing_time:
 *                           type: number
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Distance matrix endpoint
app.post("/matrix", async (req, res) => {
  try {
    const { sources, destinations, ...options } = req.body;

    if (!sources || !destinations) {
      return res
        .status(400)
        .json({ error: "Sources and destinations are required" });
    }

    const result = await osrmService.getTable(sources, destinations, options);

    // Add analytics
    result.analytics = {
      total_combinations: sources.length * destinations.length,
      processing_time: Date.now() - req.startTime,
    };

    res.json(result);
  } catch (error) {
    logger.error("Matrix endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /optimize:
 *   post:
 *     tags: [Optimization]
 *     summary: Optimize trip route (TSP solver)
 *     description: Solve the Traveling Salesman Problem to find the optimal route through multiple waypoints
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [waypoints]
 *             properties:
 *               waypoints:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/Coordinate'
 *                 minItems: 2
 *                 description: Array of waypoints to optimize
 *                 example: [{"lng":13.388860,"lat":52.517037},{"lng":13.397634,"lat":52.529407},{"lng":13.428555,"lat":52.523219}]
 *               roundtrip:
 *                 type: string
 *                 enum: [true, false]
 *                 default: false
 *                 description: Return to starting point
 *               source:
 *                 type: string
 *                 enum: [first, any]
 *                 default: first
 *                 description: Starting waypoint constraint
 *               destination:
 *                 type: string
 *                 enum: [last, any]
 *                 default: last
 *                 description: Ending waypoint constraint
 *     responses:
 *       200:
 *         description: Trip optimized successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: Ok
 *                 trips:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       distance:
 *                         type: number
 *                       duration:
 *                         type: number
 *                       geometry:
 *                         type: string
 *                 optimization:
 *                   type: object
 *                   properties:
 *                     total_distance:
 *                       type: number
 *                     total_duration:
 *                       type: number
 *                     waypoints_count:
 *                       type: number
 *                     efficiency_score:
 *                       type: number
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Trip optimization endpoint
app.post("/optimize", async (req, res) => {
  try {
    const { waypoints, ...options } = req.body;

    if (!waypoints || waypoints.length < 2) {
      return res
        .status(400)
        .json({ error: "At least 2 waypoints are required" });
    }

    const result = await osrmService.optimizeTrip(waypoints, options);

    // Calculate savings
    if (result.trips && result.trips.length > 0) {
      const trip = result.trips[0];
      result.optimization = {
        total_distance: trip.distance,
        total_duration: trip.duration,
        waypoints_count: waypoints.length,
        efficiency_score: Math.round(
          (1 - trip.duration / (waypoints.length * 3600)) * 100
        ),
      };
    }

    res.json(result);
  } catch (error) {
    logger.error("Optimize endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GPS trace matching endpoint
app.post("/match", async (req, res) => {
  try {
    const { coordinates, timestamps, ...options } = req.body;

    if (!coordinates || !timestamps) {
      return res
        .status(400)
        .json({ error: "Coordinates and timestamps are required" });
    }

    if (coordinates.length !== timestamps.length) {
      return res.status(400).json({
        error: "Coordinates and timestamps must have the same length",
      });
    }

    const result = await osrmService.matchTrace(
      coordinates,
      timestamps,
      options
    );

    // Add matching statistics
    if (result.matchings && result.matchings.length > 0) {
      const matching = result.matchings[0];
      result.statistics = {
        confidence: matching.confidence || 0,
        matched_points: coordinates.length,
        total_distance: matching.distance,
        total_duration: matching.duration,
      };
    }

    res.json(result);
  } catch (error) {
    logger.error("Match endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /nearest:
 *   get:
 *     tags: [Utilities]
 *     summary: Find nearest road
 *     description: Find the nearest road(s) to a given coordinate
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema:
 *           type: number
 *           format: double
 *           minimum: -90
 *           maximum: 90
 *         description: Latitude in decimal degrees
 *         example: 52.517037
 *       - in: query
 *         name: lng
 *         required: true
 *         schema:
 *           type: number
 *           format: double
 *           minimum: -180
 *           maximum: 180
 *         description: Longitude in decimal degrees
 *         example: 13.388860
 *       - in: query
 *         name: number
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 10
 *           default: 1
 *         description: Number of nearest roads to return
 *     responses:
 *       200:
 *         description: Nearest road(s) found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: Ok
 *                 waypoints:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       location:
 *                         type: array
 *                         items:
 *                           type: number
 *                         description: Snapped coordinate [lng, lat]
 *                       name:
 *                         type: string
 *                         description: Street name
 *                       distance:
 *                         type: number
 *                         description: Distance to input coordinate in meters
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Nearest roads endpoint
app.get("/nearest", async (req, res) => {
  try {
    const { lat, lng, number = 1 } = req.query;

    if (!lat || !lng) {
      return res
        .status(400)
        .json({ error: "Latitude and longitude are required" });
    }

    const coordinate = { lat: parseFloat(lat), lng: parseFloat(lng) };
    const result = await osrmService.findNearest(coordinate, {
      number: parseInt(number),
    });

    res.json(result);
  } catch (error) {
    logger.error("Nearest endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Isochrone endpoint (using multiple route calculations)
app.post("/isochrone", async (req, res) => {
  try {
    const {
      center,
      time_limits = [300, 600, 900],
      profile = "driving",
    } = req.body;

    if (!center) {
      return res.status(400).json({ error: "Center coordinate is required" });
    }

    // Generate points in a grid around the center
    const gridPoints = [];
    const step = 0.01; // roughly 1km
    const range = 0.1; // roughly 10km radius

    for (let lat = center.lat - range; lat <= center.lat + range; lat += step) {
      for (
        let lng = center.lng - range;
        lng <= center.lng + range;
        lng += step
      ) {
        gridPoints.push({ lat, lng });
      }
    }

    // Calculate routes to all grid points
    const routes = await Promise.allSettled(
      gridPoints.map((point) =>
        osrmService.getRoute([center, point], { overview: "false" })
      )
    );

    // Group points by time limits
    const isochrones = time_limits.map((timeLimit) => {
      const reachablePoints = [];

      routes.forEach((result, index) => {
        if (
          result.status === "fulfilled" &&
          result.value.routes &&
          result.value.routes.length > 0
        ) {
          const duration = result.value.routes[0].duration;
          if (duration <= timeLimit) {
            reachablePoints.push(gridPoints[index]);
          }
        }
      });

      return {
        time_limit: timeLimit,
        reachable_points: reachablePoints.length,
        points: reachablePoints,
      };
    });

    res.json({ center, isochrones });
  } catch (error) {
    logger.error("Isochrone endpoint error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Cache statistics endpoint
app.get("/cache/stats", async (req, res) => {
  try {
    let stats = { type: "memory", keys: memoryCache.keys().length };

    if (redisClient) {
      const info = await redisClient.info("memory");
      stats = {
        type: "redis",
        memory_usage: info,
        connected: redisClient.isReady,
      };
    }

    res.json(stats);
  } catch (error) {
    logger.error("Cache stats error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Clear cache endpoint
app.delete("/cache", async (req, res) => {
  try {
    if (redisClient) {
      await redisClient.flushAll();
    }
    memoryCache.flushAll();

    res.json({ message: "Cache cleared successfully" });
  } catch (error) {
    logger.error("Cache clear error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Simple API listing endpoint
app.get("/api", (req, res) => {
  res.json({
    message: "OSRM Enhanced API - Available Endpoints",
    version: "1.0.0",
    documentation: `http://localhost:${PORT}/api-docs`,
    endpoints: {
      health: "GET /health - Health check",
      routing: "GET /route - Calculate routes with caching",
      matrix: "POST /matrix - Distance/duration matrices",
      optimization: "POST /optimize - Trip optimization (TSP)",
      matching: "POST /match - GPS trace matching",
      nearest: "GET /nearest - Find nearest roads",
      isochrone: "POST /isochrone - Reachability analysis",
      cache_stats: "GET /cache/stats - Cache statistics",
      cache_clear: "DELETE /cache - Clear cache",
    },
    examples: {
      health: `curl 'http://localhost:${PORT}/health'`,
      route: `curl 'http://localhost:${PORT}/route?waypoints=[{"lng":13.388860,"lat":52.517037},{"lng":13.397634,"lat":52.529407}]'`,
      nearest: `curl 'http://localhost:${PORT}/nearest?lat=52.517037&lng=13.388860'`,
      matrix: `curl -X POST http://localhost:${PORT}/matrix -H "Content-Type: application/json" -d '{"sources":[{"lng":13.388860,"lat":52.517037}],"destinations":[{"lng":13.397634,"lat":52.529407}]}'`,
    },
    related_services: {
      standard_osrm: "http://localhost:5001",
      frontend: "http://localhost:9966",
      grafana: "http://localhost:3000",
      prometheus: "http://localhost:9090",
    },
  });
});

// Middleware to add start time for processing time calculation
app.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error("Unhandled error:", error);
  res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Something went wrong",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully");

  if (redisClient) {
    await redisClient.quit();
  }

  process.exit(0);
});

app.listen(PORT, () => {
  logger.info(`OSRM Enhanced API server running on port ${PORT}`);
  logger.info(`OSRM Backend URL: ${OSRM_BACKEND_URL}`);
  logger.info(`Redis URL: ${REDIS_URL}`);
});
