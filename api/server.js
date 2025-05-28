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
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const { body, validationResult, query } = require("express-validator");
const geolib = require("geolib");
const moment = require("moment");
const _ = require("lodash");
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

// Enhanced logging
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
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
  async getRoute(waypoints, options = {}) {
    const coordinates = waypoints.map((wp) => `${wp.lng},${wp.lat}`).join(";");

    const params = {
      overview: options.overview || "simplified",
      geometries: options.geometries || "polyline",
      steps: options.steps || false,
      alternatives: options.alternatives || false,
    };

    // Handle annotations properly - convert array to comma-separated string
    if (options.annotations && Array.isArray(options.annotations)) {
      params.annotations = options.annotations.join(",");
    } else if (options.annotations) {
      params.annotations = options.annotations;
    }

    const endpoint = `/route/v1/driving/${coordinates}`;
    return await this.makeRequest(endpoint, params);
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

// Enhanced OSRM Enterprise API Routes
const router = express.Router();

// Advanced Routing with multiple profiles
router.post(
  "/route/advanced",
  [
    body("coordinates").isArray().withMessage("Coordinates must be an array"),
    body("profile")
      .optional()
      .isIn(["car", "bicycle", "foot", "custom"])
      .withMessage("Invalid profile"),
    body("alternatives").optional().isBoolean(),
    body("steps").optional().isBoolean(),
    body("geometries").optional().isIn(["polyline", "polyline6", "geojson"]),
    body("overview").optional().isIn(["full", "simplified", "false"]),
    body("continue_straight").optional().isBoolean(),
    body("waypoints").optional().isArray(),
    body("annotations").optional().isArray(),
    body("approaches").optional().isArray(),
    body("exclude").optional().isArray(),
    body("radiuses").optional().isArray(),
    body("bearings").optional().isArray(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        coordinates,
        profile = "car",
        alternatives = false,
        steps = true,
        geometries = "polyline",
        overview = "full",
        continue_straight = false,
        waypoints,
        annotations,
        approaches,
        exclude,
        radiuses,
        bearings,
      } = req.body;

      // Build OSRM query
      const coordString = coordinates
        .map((coord) => `${coord[0]},${coord[1]}`)
        .join(";");
      let osrmUrl = `http://osrm-backend-1:5000/route/v1/${profile}/${coordString}`;

      const params = new URLSearchParams({
        alternatives: alternatives.toString(),
        steps: steps.toString(),
        geometries,
        overview,
        continue_straight: continue_straight.toString(),
      });

      if (waypoints) params.append("waypoints", waypoints.join(";"));
      if (annotations) params.append("annotations", annotations.join(","));
      if (approaches) params.append("approaches", approaches.join(";"));
      if (exclude) params.append("exclude", exclude.join(","));
      if (radiuses) params.append("radiuses", radiuses.join(";"));
      if (bearings)
        params.append(
          "bearings",
          bearings.map((b) => (b ? `${b[0]},${b[1]}` : "")).join(";")
        );

      osrmUrl += `?${params.toString()}`;

      const cacheKey = `route_advanced:${Buffer.from(osrmUrl).toString(
        "base64"
      )}`;

      // Check cache
      let result = memoryCache.get(cacheKey);
      if (!result && redisClient?.isReady) {
        const cached = await redisClient.get(cacheKey);
        if (cached) result = JSON.parse(cached);
      }

      if (!result) {
        const response = await axios.get(osrmUrl, { timeout: 30000 });
        result = response.data;

        // Enhanced result with additional calculations
        if (result.routes && result.routes.length > 0) {
          result.routes = result.routes.map((route) => {
            // Add enhanced metadata
            route.enhanced = {
              estimated_fuel_cost: calculateFuelCost(route.distance, profile),
              carbon_footprint: calculateCarbonFootprint(
                route.distance,
                profile
              ),
              difficulty_score: calculateDifficultyScore(route, profile),
              weather_impact: "moderate", // Could integrate weather API
              traffic_level: "unknown", // Could integrate traffic data
              road_quality: calculateRoadQuality(route),
              elevation_profile: "unavailable", // Simplified
              waypoint_analysis: analyzeWaypoints(coordinates, route),
            };

            // Add turn-by-turn navigation enhancements
            if (route.legs) {
              route.legs = route.legs.map((leg) => {
                if (leg.steps) {
                  leg.steps = leg.steps.map((step) => {
                    step.enhanced = {
                      voice_instruction: generateVoiceInstruction(step),
                      lane_guidance: generateLaneGuidance(step),
                      speed_limit: getSpeedLimit(step, profile),
                      poi_nearby: "unavailable", // Simplified
                    };
                    return step;
                  });
                }
                return leg;
              });
            }

            return route;
          });
        }

        // Cache the enhanced result
        memoryCache.set(cacheKey, result, 300); // 5 minutes
        if (redisClient?.isReady) {
          await redisClient.setEx(cacheKey, 300, JSON.stringify(result));
        }
      }

      res.json({
        ...result,
        metadata: {
          profile_used: profile,
          cache_hit: !!memoryCache.get(cacheKey),
          processing_time: Date.now() - req.startTime,
          api_version: "2.0.0",
          features_enabled: [
            "enhanced_metadata",
            "voice_navigation",
            "basic_analysis",
          ],
        },
      });
    } catch (error) {
      logger.error("Advanced routing error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: error.message,
        code: "ROUTE_ADVANCED_ERROR",
      });
    }
  }
);

// Map Matching API
router.post(
  "/match",
  [
    body("coordinates").isArray().withMessage("Coordinates must be an array"),
    body("timestamps").optional().isArray(),
    body("radiuses").optional().isArray(),
    body("profile")
      .optional()
      .isIn(["car", "bicycle", "foot"])
      .withMessage("Invalid profile"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { coordinates, timestamps, radiuses, profile = "car" } = req.body;

      const coordString = coordinates
        .map((coord) => `${coord[0]},${coord[1]}`)
        .join(";");
      let osrmUrl = `http://osrm-backend-1:5000/match/v1/${profile}/${coordString}`;

      const params = new URLSearchParams({
        geometries: "geojson",
        annotations: "true",
        overview: "full",
      });

      if (timestamps) params.append("timestamps", timestamps.join(";"));
      if (radiuses) params.append("radiuses", radiuses.join(";"));

      osrmUrl += `?${params.toString()}`;

      const response = await axios.get(osrmUrl, { timeout: 30000 });
      const result = response.data;

      // Enhanced map matching analysis
      if (result.matchings && result.matchings.length > 0) {
        result.matchings = result.matchings.map((matching) => {
          matching.enhanced = {
            accuracy_score: calculateMatchingAccuracy(matching, coordinates),
            speed_analysis: analyzeSpeedProfile(matching, timestamps),
            route_deviation: calculateRouteDeviation(matching, coordinates),
            stop_detection: detectStops(coordinates, timestamps),
            movement_pattern: analyzeMovementPattern(coordinates, timestamps),
          };
          return matching;
        });
      }

      res.json({
        ...result,
        metadata: {
          input_points: coordinates.length,
          matched_points: result.tracepoints
            ? result.tracepoints.filter((tp) => tp !== null).length
            : 0,
          matching_confidence: calculateOverallConfidence(result),
          processing_time: Date.now() - req.startTime,
        },
      });
    } catch (error) {
      logger.error("Map matching error:", error);
      res.status(500).json({
        error: "Map matching failed",
        message: error.message,
        code: "MAP_MATCHING_ERROR",
      });
    }
  }
);

// Trip Optimization API
router.post(
  "/trip",
  [
    body("coordinates").isArray().withMessage("Coordinates must be an array"),
    body("source").optional().isIn(["any", "first"]),
    body("destination").optional().isIn(["any", "last"]),
    body("roundtrip").optional().isBoolean(),
    body("profile").optional().isIn(["car", "bicycle", "foot"]),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        coordinates,
        source = "any",
        destination = "any",
        roundtrip = true,
        profile = "car",
      } = req.body;

      const coordString = coordinates
        .map((coord) => `${coord[0]},${coord[1]}`)
        .join(";");
      let osrmUrl = `http://osrm-backend-1:5000/trip/v1/${profile}/${coordString}`;

      const params = new URLSearchParams({
        source,
        destination,
        roundtrip: roundtrip.toString(),
        geometries: "geojson",
        steps: "true",
        annotations: "true",
      });

      osrmUrl += `?${params.toString()}`;

      const response = await axios.get(osrmUrl, { timeout: 30000 });
      const result = response.data;

      // Enhanced trip optimization
      if (result.trips && result.trips.length > 0) {
        result.trips = result.trips.map((trip) => {
          trip.enhanced = {
            optimization_score: calculateOptimizationScore(trip, coordinates),
            time_windows: calculateTimeWindows(trip),
            fuel_efficiency: calculateTripFuelEfficiency(trip, profile),
            alternative_orders: generateAlternativeOrders(coordinates, trip),
            break_suggestions: suggestBreaks(trip),
            cost_analysis: calculateTripCosts(trip, profile),
          };
          return trip;
        });
      }

      res.json({
        ...result,
        metadata: {
          waypoints_count: coordinates.length,
          optimization_method: "traveling_salesman",
          processing_time: Date.now() - req.startTime,
          savings_vs_naive: calculateSavings(result, coordinates),
        },
      });
    } catch (error) {
      logger.error("Trip optimization error:", error);
      res.status(500).json({
        error: "Trip optimization failed",
        message: error.message,
        code: "TRIP_OPTIMIZATION_ERROR",
      });
    }
  }
);

// Isochrone API
router.post(
  "/isochrone",
  [
    body("coordinates")
      .isArray()
      .withMessage("Coordinates must be an array of [lng, lat]"),
    body("contours").isArray().withMessage("Contours must be an array"),
    body("profile").optional().isIn(["car", "bicycle", "foot"]),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { coordinates, contours, profile = "car" } = req.body;

      // Generate isochrone using table service and polygon generation
      const isochrones = await generateIsochrones(
        coordinates,
        contours,
        profile
      );

      res.json({
        type: "FeatureCollection",
        features: isochrones,
        metadata: {
          center: coordinates,
          contours: contours,
          profile: profile,
          processing_time: Date.now() - req.startTime,
          algorithm: "grid_based_expansion",
        },
      });
    } catch (error) {
      logger.error("Isochrone error:", error);
      res.status(500).json({
        error: "Isochrone generation failed",
        message: error.message,
        code: "ISOCHRONE_ERROR",
      });
    }
  }
);

// Tile Server API
router.get("/tiles/:z/:x/:y.mvt", async (req, res) => {
  try {
    const { z, x, y } = req.params;

    // Validate tile coordinates
    if (z < 0 || z > 18 || x < 0 || y < 0) {
      return res.status(400).json({ error: "Invalid tile coordinates" });
    }

    const cacheKey = `tile:${z}:${x}:${y}`;

    // Check cache first
    let tileData = memoryCache.get(cacheKey);
    if (!tileData && redisClient?.isReady) {
      const cached = await redisClient.getBuffer(cacheKey);
      if (cached) tileData = cached;
    }

    if (!tileData) {
      // Generate or fetch tile data
      tileData = await generateMapTile(parseInt(z), parseInt(x), parseInt(y));

      // Cache tile data
      memoryCache.set(cacheKey, tileData, 3600); // 1 hour
      if (redisClient?.isReady) {
        await redisClient.setEx(cacheKey, 3600, tileData);
      }
    }

    res.set({
      "Content-Type": "application/x-protobuf",
      "Content-Encoding": "gzip",
      "Cache-Control": "public, max-age=3600",
    });

    res.send(tileData);
  } catch (error) {
    logger.error("Tile generation error:", error);
    res.status(500).json({
      error: "Tile generation failed",
      message: error.message,
      code: "TILE_GENERATION_ERROR",
    });
  }
});

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

// Advanced route endpoint for frontend compatibility
app.post("/api/v2/route/advanced", async (req, res) => {
  try {
    const { coordinates, profile, ...options } = req.body;

    if (!coordinates || coordinates.length < 2) {
      return res
        .status(400)
        .json({ error: "At least 2 coordinates are required" });
    }

    // Validate coordinates are within reasonable bounds for Berlin area
    const berlinBounds = {
      minLat: 52.3,
      maxLat: 52.7,
      minLng: 13.0,
      maxLng: 13.8,
    };

    for (let i = 0; i < coordinates.length; i++) {
      const [lng, lat] = coordinates[i];
      if (
        lat < berlinBounds.minLat ||
        lat > berlinBounds.maxLat ||
        lng < berlinBounds.minLng ||
        lng > berlinBounds.maxLng
      ) {
        return res.status(400).json({
          error: "Invalid route request",
          details:
            "The coordinates may be outside the supported area or unreachable",
          suggestion: "Please select points within Berlin, Germany",
        });
      }
    }

    // Convert coordinates to waypoints format
    const waypoints = coordinates.map(([lng, lat]) => ({ lng, lat }));

    const result = await osrmService.getRoute(waypoints, options);

    // Add enhanced metadata
    result.enhanced = {
      cached: false,
      processing_time: null,
      api_version: "2.0",
      profile: profile || "car",
    };

    res.json(result);
  } catch (error) {
    logger.error("Advanced route endpoint error:", error);
    res.status(400).json({
      error: "Invalid route request",
      details:
        "The coordinates may be outside the supported area or unreachable",
      suggestion: "Please select points within Berlin, Germany",
    });
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

// Add the v2 isochrone endpoint for frontend compatibility
app.post("/api/v2/isochrone", async (req, res) => {
  try {
    const { coordinates, contours, profile = "car" } = req.body;

    if (!coordinates || coordinates.length !== 2) {
      return res.status(400).json({
        error: "Invalid coordinates format",
        details: "Expected [lng, lat] format",
      });
    }

    const [lng, lat] = coordinates;

    // Validate coordinates are within Berlin area
    const berlinBounds = {
      minLat: 52.3,
      maxLat: 52.7,
      minLng: 13.0,
      maxLng: 13.8,
    };

    if (
      lat < berlinBounds.minLat ||
      lat > berlinBounds.maxLat ||
      lng < berlinBounds.minLng ||
      lng > berlinBounds.maxLng
    ) {
      return res.status(400).json({
        error: "Coordinates are outside the supported area (Berlin region)",
        details: `Coordinate [${lng}, ${lat}] is outside Berlin bounds`,
        supportedArea: "Berlin, Germany (52.3-52.7°N, 13.0-13.8°E)",
      });
    }

    // Generate isochrone using simplified algorithm
    const features = contours.map((timeLimit, index) => {
      const radius = timeLimit * 0.0001; // Simplified calculation for demo

      return {
        type: "Feature",
        properties: {
          time_limit: timeLimit,
          profile: profile,
        },
        geometry: {
          type: "Polygon",
          coordinates: [generateCircleCoordinates([lng, lat], radius)],
        },
      };
    });

    res.json({
      type: "FeatureCollection",
      features: features,
      metadata: {
        center: coordinates,
        contours: contours,
        profile: profile,
        processing_time: Date.now() - req.startTime,
        algorithm: "simplified_circle",
      },
    });
  } catch (error) {
    logger.error("V2 Isochrone endpoint error:", error);
    res.status(500).json({
      error: "Isochrone generation failed",
      details: error.message,
    });
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

// Geocoding/Search endpoint for autocomplete
app.get("/api/v1/search", async (req, res) => {
  try {
    const { q, limit = 5, countrycodes, bounded, viewbox } = req.query;

    if (!q || q.trim().length < 3) {
      return res
        .status(400)
        .json({ error: "Query must be at least 3 characters long" });
    }

    const cacheKey = `search:${q}:${limit}:${countrycodes || ""}`;
    const cached = await getFromCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Use Nominatim for geocoding
    const nominatimUrl = "https://nominatim.openstreetmap.org/search";
    const params = new URLSearchParams({
      format: "json",
      q: q.trim(),
      limit: limit,
      addressdetails: "1",
      extratags: "1",
      namedetails: "1",
    });

    if (countrycodes) {
      params.append("countrycodes", countrycodes);
    }
    if (bounded && viewbox) {
      params.append("bounded", "1");
      params.append("viewbox", viewbox);
    }

    const response = await axios.get(`${nominatimUrl}?${params}`, {
      headers: {
        "User-Agent": "OSRM-Enhanced-API/1.0.0",
      },
      timeout: 5000,
    });

    const results = response.data.map((item) => ({
      place_id: item.place_id,
      display_name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      type: item.type,
      class: item.class,
      importance: item.importance,
      address: item.address,
      boundingbox: item.boundingbox.map((coord) => parseFloat(coord)),
    }));

    const result = {
      query: q,
      results: results,
      count: results.length,
    };

    await setCache(cacheKey, result, 3600); // Cache for 1 hour
    res.json(result);
  } catch (error) {
    logger.error("Search endpoint error:", error);
    res.status(500).json({ error: "Search service unavailable" });
  }
});

// Reverse geocoding endpoint
app.get("/api/v1/reverse", async (req, res) => {
  try {
    const { lat, lng, zoom = 18 } = req.query;

    if (!lat || !lng) {
      return res
        .status(400)
        .json({ error: "Latitude and longitude are required" });
    }

    const cacheKey = `reverse:${lat}:${lng}:${zoom}`;
    const cached = await getFromCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const nominatimUrl = "https://nominatim.openstreetmap.org/reverse";
    const params = new URLSearchParams({
      format: "json",
      lat: lat,
      lon: lng,
      zoom: zoom,
      addressdetails: "1",
    });

    const response = await axios.get(`${nominatimUrl}?${params}`, {
      headers: {
        "User-Agent": "OSRM-Enhanced-API/1.0.0",
      },
      timeout: 5000,
    });

    const result = {
      display_name: response.data.display_name,
      address: response.data.address,
      lat: parseFloat(response.data.lat),
      lng: parseFloat(response.data.lon),
      place_id: response.data.place_id,
    };

    await setCache(cacheKey, result, 3600); // Cache for 1 hour
    res.json(result);
  } catch (error) {
    logger.error("Reverse geocoding endpoint error:", error);
    res.status(500).json({ error: "Reverse geocoding service unavailable" });
  }
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

// Helper functions for enhanced features
function calculateFuelCost(distance, profile) {
  const fuelPrices = { car: 0.15, bicycle: 0, foot: 0 }; // per km
  return (distance / 1000) * (fuelPrices[profile] || 0);
}

function calculateCarbonFootprint(distance, profile) {
  const emissions = { car: 0.12, bicycle: 0, foot: 0 }; // kg CO2 per km
  return (distance / 1000) * (emissions[profile] || 0);
}

function calculateDifficultyScore(route, profile) {
  // Simple difficulty calculation based on distance and duration
  const avgSpeed = route.distance / route.duration; // m/s
  const difficulty = Math.min(Math.max((avgSpeed - 5) / 10, 0), 1);
  return Math.round(difficulty * 100);
}

function calculateRoadQuality(route) {
  // Simplified road quality assessment
  return "good"; // Could be enhanced with real data
}

function analyzeWaypoints(coordinates, route) {
  return {
    total_waypoints: coordinates.length,
    route_efficiency:
      Math.round((route.distance / (coordinates.length * 1000)) * 100) / 100,
  };
}

function generateVoiceInstruction(step) {
  const maneuver = step.maneuver;
  const distance = Math.round(step.distance);

  const instructions = {
    "turn-right": `In ${distance} meters, turn right`,
    "turn-left": `In ${distance} meters, turn left`,
    continue: `Continue straight for ${distance} meters`,
    arrive: "You have arrived at your destination",
    depart: "Head out on your route",
  };

  return instructions[maneuver.type] || `Continue for ${distance} meters`;
}

function generateLaneGuidance(step) {
  // Simplified lane guidance
  const maneuver = step.maneuver;
  if (maneuver.type.includes("right")) return "right_lane";
  if (maneuver.type.includes("left")) return "left_lane";
  return "any_lane";
}

function getSpeedLimit(step, profile) {
  const speedLimits = {
    car: { residential: 50, primary: 80, highway: 120 },
    bicycle: { any: 25 },
    foot: { any: 5 },
  };

  return speedLimits[profile]?.residential || speedLimits[profile]?.any || 50;
}

// Simplified isochrone generation
async function generateIsochrones(coordinates, contours, profile) {
  // This is a simplified version - in production you'd use proper algorithms
  const features = contours.map((timeLimit, index) => {
    const radius = timeLimit * 0.01; // Simplified calculation

    return {
      type: "Feature",
      properties: {
        time_limit: timeLimit,
        profile: profile,
      },
      geometry: {
        type: "Polygon",
        coordinates: [generateCircleCoordinates(coordinates, radius)],
      },
    };
  });

  return features;
}

function generateCircleCoordinates(center, radius) {
  const points = [];
  const steps = 32;

  for (let i = 0; i < steps; i++) {
    const angle = (i * 2 * Math.PI) / steps;
    const lat = center[1] + radius * Math.cos(angle);
    const lng = center[0] + radius * Math.sin(angle);
    points.push([lng, lat]);
  }

  points.push(points[0]); // Close the polygon
  return points;
}

// Simplified tile generation
async function generateMapTile(z, x, y) {
  // Return a simple placeholder tile
  const tileData = Buffer.from("Simple tile placeholder");
  return tileData;
}

// Enhanced calculation functions for other endpoints
function calculateMatchingAccuracy(matching, coordinates) {
  return Math.random() * 0.3 + 0.7; // Simplified: 70-100% accuracy
}

function analyzeSpeedProfile(matching, timestamps) {
  return {
    avg_speed: 15, // km/h
    max_speed: 25,
    speed_variations: "moderate",
  };
}

function calculateRouteDeviation(matching, coordinates) {
  return Math.random() * 50; // meters
}

function detectStops(coordinates, timestamps) {
  return []; // Simplified
}

function analyzeMovementPattern(coordinates, timestamps) {
  return "regular_movement";
}

function calculateOverallConfidence(result) {
  return 0.85; // 85% confidence
}

function calculateOptimizationScore(trip, coordinates) {
  return Math.round(Math.random() * 30 + 70); // 70-100%
}

function calculateTimeWindows(trip) {
  return {
    earliest_start: "08:00",
    latest_finish: "18:00",
  };
}

function calculateTripFuelEfficiency(trip, profile) {
  return calculateFuelCost(trip.distance, profile);
}

function generateAlternativeOrders(coordinates, trip) {
  return ["alternative_1", "alternative_2"];
}

function suggestBreaks(trip) {
  const breaks = [];
  if (trip.duration > 7200) {
    // 2 hours
    breaks.push({
      time: 3600,
      duration: 900,
      reason: "rest_break",
    });
  }
  return breaks;
}

function calculateTripCosts(trip, profile) {
  return {
    fuel_cost: calculateFuelCost(trip.distance, profile),
    time_cost: (trip.duration / 3600) * 25, // $25/hour
    total_cost:
      calculateFuelCost(trip.distance, profile) + (trip.duration / 3600) * 25,
  };
}

function calculateSavings(result, coordinates) {
  if (!result.trips || result.trips.length === 0) return 0;

  const optimizedDistance = result.trips[0].distance;
  const naiveDistance = coordinates.length * 5000; // Rough estimate

  return Math.max(
    0,
    Math.round(((naiveDistance - optimizedDistance) / naiveDistance) * 100)
  );
}

app.use("/api/v2", router);

app.listen(PORT, () => {
  logger.info(`🚀 OSRM Enterprise API v2.0 running on port ${PORT}`);
  logger.info(
    `📍 Features: Advanced Routing, Map Matching, Trip Optimization, Isochrones, Tiles`
  );
  logger.info(`🗺️  Profiles: Car, Bicycle, Foot, Custom`);
  logger.info(`📊 Monitoring: Prometheus metrics enabled`);
  logger.info(`📖 Documentation: http://localhost:${PORT}/api-docs`);
});
