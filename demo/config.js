// OSRM Enterprise Frontend Configuration
// Change these settings based on your data region

const OSRM_CONFIG = {
  // Current region configuration
  // Options: 'berlin', 'india', 'asia', 'world'
  REGION: "asia",

  // Region-specific settings
  REGIONS: {
    berlin: {
      name: "Berlin, Germany",
      center: [52.52, 13.405],
      zoom: 13,
      bounds: {
        southwest: [52.3, 13.0],
        northeast: [52.7, 13.8],
      },
      restrictBounds: true,
      geocodingCountries: "de",
      welcomeMessage:
        "Welcome! This demo supports routing within Berlin, Germany (highlighted area). Click within the blue boundary to set route points.",
    },

    india: {
      name: "India",
      center: [20.5937, 78.9629], // Center of India
      zoom: 5,
      bounds: {
        southwest: [6.4627, 68.1097], // Southern tip of India
        northeast: [35.5044, 97.4152], // Northern tip of India
      },
      restrictBounds: false, // Allow panning outside for context
      geocodingCountries: "in",
      welcomeMessage:
        "Welcome! This demo supports routing throughout India. Click anywhere on the map to set route points.",
    },

    asia: {
      name: "Asia",
      center: [34.0479, 100.6197], // Center of Asia
      zoom: 3,
      bounds: {
        southwest: [-10, 60], // Rough Asia bounds
        northeast: [70, 180],
      },
      restrictBounds: false,
      geocodingCountries: "in,cn,jp,kr,th,vn,my,sg,id,ph",
      welcomeMessage:
        "Welcome! This demo supports routing throughout Asia. Click anywhere on the map to set route points.",
    },

    world: {
      name: "World",
      center: [20, 0], // Center of world
      zoom: 2,
      bounds: {
        southwest: [-90, -180],
        northeast: [90, 180],
      },
      restrictBounds: false,
      geocodingCountries: "", // All countries
      welcomeMessage:
        "Welcome! This demo supports global routing. Click anywhere on the map to set route points.",
    },
  },

  // API Configuration
  API: {
    baseUrl: "http://localhost:3003",
    routeEndpoint: "/api/v2/route/advanced",
    geocodingEndpoint: "/api/v2/geocoding/search",
  },

  // Map Configuration
  MAP: {
    tileServer: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    // Alternative: Self-hosted tiles
    // tileServer: 'http://localhost:3001/tiles/{z}/{x}/{y}.png',
    attribution: "© OpenStreetMap contributors | OSRM Enterprise Stack",
    maxZoom: 19,
  },
};

// Get current region configuration
function getCurrentRegionConfig() {
  return OSRM_CONFIG.REGIONS[OSRM_CONFIG.REGION];
}

// Export for use in other files
if (typeof module !== "undefined" && module.exports) {
  module.exports = OSRM_CONFIG;
}
