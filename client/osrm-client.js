/**
 * OSRM Enhanced API Client
 * A comprehensive JavaScript client for the OSRM Enhanced API
 */

class OSRMClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || "http://localhost:3001";
    this.timeout = options.timeout || 30000;
    this.apiKey = options.apiKey || null;
    this.retries = options.retries || 3;
    this.retryDelay = options.retryDelay || 1000;
  }

  /**
   * Make HTTP request with retry logic
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
        ...options.headers,
      },
      ...options,
    };

    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const response = await fetch(url, config);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        if (attempt === this.retries) {
          throw new Error(
            `Request failed after ${this.retries} attempts: ${error.message}`
          );
        }

        // Wait before retry
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelay * attempt)
        );
      }
    }
  }

  /**
   * Calculate route between waypoints
   */
  async getRoute(waypoints, options = {}) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      throw new Error("At least 2 waypoints are required");
    }

    const params = new URLSearchParams({
      waypoints: JSON.stringify(waypoints),
      ...options,
    });

    return await this.makeRequest(`/route?${params}`);
  }

  /**
   * Calculate distance/duration matrix
   */
  async getMatrix(sources, destinations, options = {}) {
    if (!Array.isArray(sources) || !Array.isArray(destinations)) {
      throw new Error("Sources and destinations must be arrays");
    }

    return await this.makeRequest("/matrix", {
      method: "POST",
      body: JSON.stringify({
        sources,
        destinations,
        ...options,
      }),
    });
  }

  /**
   * Optimize trip (Traveling Salesman Problem)
   */
  async optimizeTrip(waypoints, options = {}) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
      throw new Error("At least 2 waypoints are required");
    }

    return await this.makeRequest("/optimize", {
      method: "POST",
      body: JSON.stringify({
        waypoints,
        ...options,
      }),
    });
  }

  /**
   * Match GPS trace to road network
   */
  async matchTrace(coordinates, timestamps, options = {}) {
    if (!Array.isArray(coordinates) || !Array.isArray(timestamps)) {
      throw new Error("Coordinates and timestamps must be arrays");
    }

    if (coordinates.length !== timestamps.length) {
      throw new Error("Coordinates and timestamps must have the same length");
    }

    return await this.makeRequest("/match", {
      method: "POST",
      body: JSON.stringify({
        coordinates,
        timestamps,
        ...options,
      }),
    });
  }

  /**
   * Find nearest roads
   */
  async findNearest(coordinate, options = {}) {
    if (
      !coordinate ||
      typeof coordinate.lat !== "number" ||
      typeof coordinate.lng !== "number"
    ) {
      throw new Error("Valid coordinate with lat and lng is required");
    }

    const params = new URLSearchParams({
      lat: coordinate.lat,
      lng: coordinate.lng,
      ...options,
    });

    return await this.makeRequest(`/nearest?${params}`);
  }

  /**
   * Generate isochrone (reachability analysis)
   */
  async getIsochrone(center, timeLimits = [300, 600, 900], options = {}) {
    if (
      !center ||
      typeof center.lat !== "number" ||
      typeof center.lng !== "number"
    ) {
      throw new Error("Valid center coordinate with lat and lng is required");
    }

    return await this.makeRequest("/isochrone", {
      method: "POST",
      body: JSON.stringify({
        center,
        time_limits: timeLimits,
        ...options,
      }),
    });
  }

  /**
   * Get service health status
   */
  async getHealth() {
    return await this.makeRequest("/health");
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    return await this.makeRequest("/cache/stats");
  }

  /**
   * Clear cache
   */
  async clearCache() {
    return await this.makeRequest("/cache", { method: "DELETE" });
  }
}

/**
 * Navigation Service - Higher level navigation functionality
 */
class NavigationService extends OSRMClient {
  constructor(options = {}) {
    super(options);
    this.currentRoute = null;
    this.currentPosition = null;
  }

  /**
   * Start navigation session
   */
  async startNavigation(start, destination, options = {}) {
    try {
      const route = await this.getRoute([start, destination], {
        steps: true,
        overview: "full",
        geometries: "polyline",
        ...options,
      });

      this.currentRoute = route;
      this.currentPosition = start;

      return {
        success: true,
        route: route,
        totalDistance: route.routes[0]?.distance || 0,
        totalDuration: route.routes[0]?.duration || 0,
        steps: route.routes[0]?.legs[0]?.steps || [],
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update current position and get navigation instructions
   */
  async updatePosition(newPosition) {
    this.currentPosition = newPosition;

    if (!this.currentRoute) {
      throw new Error("No active navigation session");
    }

    // Find nearest point on route
    const nearest = await this.findNearest(newPosition);

    return {
      position: newPosition,
      nearestRoad: nearest.waypoints[0],
      remainingDistance: this.calculateRemainingDistance(newPosition),
      nextInstruction: this.getNextInstruction(newPosition),
    };
  }

  /**
   * Calculate remaining distance (simplified)
   */
  calculateRemainingDistance(position) {
    if (!this.currentRoute || !this.currentRoute.routes[0]) {
      return 0;
    }

    // This is a simplified calculation
    // In a real implementation, you'd calculate the actual remaining distance
    return this.currentRoute.routes[0].distance;
  }

  /**
   * Get next navigation instruction
   */
  getNextInstruction(position) {
    if (!this.currentRoute || !this.currentRoute.routes[0]?.legs[0]?.steps) {
      return null;
    }

    const steps = this.currentRoute.routes[0].legs[0].steps;
    // Return first step as example
    return steps[0]?.maneuver?.instruction || "Continue straight";
  }
}

/**
 * Fleet Management Service - For managing multiple vehicles
 */
class FleetService extends OSRMClient {
  constructor(options = {}) {
    super(options);
    this.vehicles = new Map();
  }

  /**
   * Add vehicle to fleet
   */
  addVehicle(vehicleId, position, capacity = 1) {
    this.vehicles.set(vehicleId, {
      id: vehicleId,
      position: position,
      capacity: capacity,
      currentLoad: 0,
      route: null,
      status: "idle",
    });
  }

  /**
   * Remove vehicle from fleet
   */
  removeVehicle(vehicleId) {
    return this.vehicles.delete(vehicleId);
  }

  /**
   * Get optimal vehicle assignments for deliveries
   */
  async optimizeDeliveries(deliveries, options = {}) {
    const vehicles = Array.from(this.vehicles.values());
    const vehiclePositions = vehicles.map((v) => v.position);
    const deliveryPositions = deliveries.map((d) => d.position);

    // Calculate distance matrix
    const matrix = await this.getMatrix(vehiclePositions, deliveryPositions);

    // Simple assignment algorithm (in practice, use more sophisticated algorithms)
    const assignments = this.assignDeliveries(vehicles, deliveries, matrix);

    return assignments;
  }

  /**
   * Simple delivery assignment algorithm
   */
  assignDeliveries(vehicles, deliveries, matrix) {
    const assignments = [];
    const availableVehicles = vehicles.filter((v) => v.status === "idle");

    deliveries.forEach((delivery, deliveryIndex) => {
      let bestVehicle = null;
      let shortestDistance = Infinity;

      availableVehicles.forEach((vehicle, vehicleIndex) => {
        const distance =
          matrix.distances[vehicleIndex * deliveries.length + deliveryIndex];
        if (
          distance < shortestDistance &&
          vehicle.currentLoad < vehicle.capacity
        ) {
          shortestDistance = distance;
          bestVehicle = vehicle;
        }
      });

      if (bestVehicle) {
        assignments.push({
          vehicleId: bestVehicle.id,
          delivery: delivery,
          distance: shortestDistance,
          estimatedTime:
            matrix.durations[
              availableVehicles.indexOf(bestVehicle) * deliveries.length +
                deliveryIndex
            ],
        });
        bestVehicle.currentLoad++;
      }
    });

    return assignments;
  }

  /**
   * Get fleet status
   */
  getFleetStatus() {
    return {
      totalVehicles: this.vehicles.size,
      activeVehicles: Array.from(this.vehicles.values()).filter(
        (v) => v.status === "active"
      ).length,
      idleVehicles: Array.from(this.vehicles.values()).filter(
        (v) => v.status === "idle"
      ).length,
      vehicles: Array.from(this.vehicles.values()),
    };
  }
}

/**
 * Utility functions
 */
class OSRMUtils {
  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  static calculateDistance(coord1, coord2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (coord1.lat * Math.PI) / 180;
    const φ2 = (coord2.lat * Math.PI) / 180;
    const Δφ = ((coord2.lat - coord1.lat) * Math.PI) / 180;
    const Δλ = ((coord2.lng - coord1.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Decode polyline string to coordinates
   */
  static decodePolyline(str, precision = 5) {
    let index = 0;
    let lat = 0;
    let lng = 0;
    const coordinates = [];
    const factor = Math.pow(10, precision);

    while (index < str.length) {
      let byte = null;
      let shift = 0;
      let result = 0;

      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lat += deltaLat;

      shift = 0;
      result = 0;

      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lng += deltaLng;

      coordinates.push({
        lat: lat / factor,
        lng: lng / factor,
      });
    }

    return coordinates;
  }

  /**
   * Encode coordinates to polyline string
   */
  static encodePolyline(coordinates, precision = 5) {
    if (!coordinates.length) return "";

    const factor = Math.pow(10, precision);
    let output =
      this.encode(coordinates[0].lat, factor) +
      this.encode(coordinates[0].lng, factor);

    for (let i = 1; i < coordinates.length; i++) {
      const a = coordinates[i];
      const b = coordinates[i - 1];
      output += this.encode(a.lat - b.lat, factor);
      output += this.encode(a.lng - b.lng, factor);
    }

    return output;
  }

  static encode(current, factor) {
    current = Math.round(current * factor);
    current <<= 1;
    if (current < 0) {
      current = ~current;
    }
    let output = "";
    while (current >= 0x20) {
      output += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
      current >>= 5;
    }
    output += String.fromCharCode(current + 63);
    return output;
  }

  /**
   * Format duration in human readable format
   */
  static formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  /**
   * Format distance in human readable format
   */
  static formatDistance(meters) {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    } else {
      return `${Math.round(meters)} m`;
    }
  }
}

// Export for different environments
if (typeof module !== "undefined" && module.exports) {
  // Node.js
  module.exports = {
    OSRMClient,
    NavigationService,
    FleetService,
    OSRMUtils,
  };
} else if (typeof window !== "undefined") {
  // Browser
  window.OSRMClient = OSRMClient;
  window.NavigationService = NavigationService;
  window.FleetService = FleetService;
  window.OSRMUtils = OSRMUtils;
}

// Example usage:
/*
// Basic client
const client = new OSRMClient({
  baseUrl: 'http://localhost:3001',
  timeout: 30000
});

// Get route
const route = await client.getRoute([
  { lng: 13.388860, lat: 52.517037 },
  { lng: 13.397634, lat: 52.529407 }
]);

// Navigation service
const navigation = new NavigationService();
const navResult = await navigation.startNavigation(
  { lng: 13.388860, lat: 52.517037 },
  { lng: 13.397634, lat: 52.529407 }
);

// Fleet management
const fleet = new FleetService();
fleet.addVehicle('vehicle1', { lng: 13.388860, lat: 52.517037 });
const assignments = await fleet.optimizeDeliveries([
  { id: 'delivery1', position: { lng: 13.397634, lat: 52.529407 } }
]);
*/
