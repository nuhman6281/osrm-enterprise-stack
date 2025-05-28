const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "OSRM Enhanced API",
      version: "1.0.0",
      description: `
        A comprehensive OSRM (Open Source Routing Machine) API with enhanced features including:
        - Route calculation with caching
        - Distance/duration matrices
        - GPS trace matching
        - Trip optimization (TSP solver)
        - Isochrone analysis
        - Fleet management
        - Real-time monitoring
        
        This API provides both standard OSRM endpoints and enhanced features with Redis caching,
        analytics, and additional geospatial operations.
      `,
      contact: {
        name: "OSRM Enhanced API",
        url: "https://project-osrm.org/",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "http://localhost:3001",
        description: "Development server",
      },
      {
        url: "http://localhost:5001",
        description: "Standard OSRM API (proxied)",
      },
    ],
    tags: [
      {
        name: "Health",
        description: "Health check and system status endpoints",
      },
      {
        name: "Routing",
        description: "Route calculation and navigation services",
      },
      {
        name: "Matrix",
        description: "Distance and duration matrix calculations",
      },
      {
        name: "Optimization",
        description: "Trip optimization and TSP solving",
      },
      {
        name: "Matching",
        description: "GPS trace matching to road networks",
      },
      {
        name: "Analysis",
        description: "Geospatial analysis and isochrone calculations",
      },
      {
        name: "Fleet",
        description: "Fleet management and vehicle optimization",
      },
      {
        name: "Utilities",
        description: "Utility functions and helpers",
      },
    ],
    components: {
      schemas: {
        Coordinate: {
          type: "object",
          required: ["lng", "lat"],
          properties: {
            lng: {
              type: "number",
              format: "double",
              minimum: -180,
              maximum: 180,
              description: "Longitude in decimal degrees",
              example: 13.38886,
            },
            lat: {
              type: "number",
              format: "double",
              minimum: -90,
              maximum: 90,
              description: "Latitude in decimal degrees",
              example: 52.517037,
            },
          },
        },
        Route: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Response status code",
              example: "Ok",
            },
            routes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  distance: {
                    type: "number",
                    description: "Route distance in meters",
                    example: 1886.8,
                  },
                  duration: {
                    type: "number",
                    description: "Route duration in seconds",
                    example: 248.3,
                  },
                  geometry: {
                    type: "string",
                    description: "Route geometry as polyline",
                    example: "u{~vHaowpAcC??",
                  },
                  legs: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        distance: { type: "number" },
                        duration: { type: "number" },
                        steps: { type: "array", items: { type: "object" } },
                      },
                    },
                  },
                },
              },
            },
            waypoints: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  location: {
                    type: "array",
                    items: { type: "number" },
                    description: "Snapped coordinate [lng, lat]",
                  },
                  name: {
                    type: "string",
                    description: "Street name",
                  },
                  distance: {
                    type: "number",
                    description: "Distance to input coordinate",
                  },
                },
              },
            },
          },
        },
        Matrix: {
          type: "object",
          properties: {
            code: { type: "string", example: "Ok" },
            durations: {
              type: "array",
              items: {
                type: "array",
                items: { type: "number" },
              },
              description: "Duration matrix in seconds",
            },
            distances: {
              type: "array",
              items: {
                type: "array",
                items: { type: "number" },
              },
              description: "Distance matrix in meters",
            },
            sources: {
              type: "array",
              items: { $ref: "#/components/schemas/Coordinate" },
            },
            destinations: {
              type: "array",
              items: { $ref: "#/components/schemas/Coordinate" },
            },
          },
        },
        HealthStatus: {
          type: "object",
          properties: {
            status: {
              type: "string",
              example: "healthy",
            },
            timestamp: {
              type: "string",
              format: "date-time",
            },
            uptime: {
              type: "number",
              description: "Server uptime in seconds",
            },
            memory: {
              type: "object",
              properties: {
                rss: { type: "number" },
                heapTotal: { type: "number" },
                heapUsed: { type: "number" },
                external: { type: "number" },
              },
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            error: {
              type: "string",
              description: "Error message",
            },
            code: {
              type: "string",
              description: "Error code",
            },
          },
        },
      },
      responses: {
        BadRequest: {
          description: "Bad request - invalid parameters",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        InternalError: {
          description: "Internal server error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        ServiceUnavailable: {
          description: "OSRM service unavailable",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
    },
  },
  apis: ["./server.js", "./routes/*.js"], // paths to files containing OpenAPI definitions
};

const specs = swaggerJsdoc(options);

module.exports = {
  specs,
  swaggerUi,
  serve: swaggerUi.serve,
  setup: swaggerUi.setup(specs, {
    explorer: true,
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "OSRM Enhanced API Documentation",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
    },
  }),
};
