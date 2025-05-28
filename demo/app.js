// OSRM Enterprise Maps Application
class OSRMEnterpriseApp {
  constructor() {
    this.map = null;
    this.currentRoute = null;
    this.startMarker = null;
    this.endMarker = null;
    this.routeControl = null;
    this.currentProfile = "car";
    this.features = {
      alternatives: false,
      steps: true,
      traffic: false,
      isochrones: false,
    };
    this.isochrones = [];
    this.geocodeTimeout = null;

    this.init();
  }

  init() {
    this.initMap();
    this.initEventListeners();
    this.initGeocoding();
    this.setDefaultRegionLocations();

    // Test error message system
    setTimeout(() => {
      console.log("Testing error message system...");
      this.showErrorMessage(
        "Test error message - if you see this, the message system is working!"
      );
    }, 2000);
  }

  initMap() {
    // Get current region configuration
    const regionConfig = getCurrentRegionConfig();

    // Initialize map with region-specific settings
    this.map = L.map("map").setView(regionConfig.center, regionConfig.zoom);

    // Add OpenStreetMap tiles
    this.osmLayer = L.tileLayer(OSRM_CONFIG.MAP.tileServer, {
      attribution: OSRM_CONFIG.MAP.attribution,
      maxZoom: OSRM_CONFIG.MAP.maxZoom,
    }).addTo(this.map);

    // Add satellite layer (optional)
    this.satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: "© Esri | OSRM Enterprise Stack",
        maxZoom: 19,
      }
    );

    // Add click handler for setting waypoints
    this.map.on("click", (e) => this.handleMapClick(e));

    // Configure bounds and restrictions based on region
    if (regionConfig.restrictBounds) {
      const bounds = L.latLngBounds(
        L.latLng(
          regionConfig.bounds.southwest[0],
          regionConfig.bounds.southwest[1]
        ),
        L.latLng(
          regionConfig.bounds.northeast[0],
          regionConfig.bounds.northeast[1]
        )
      );

      // Add a visual boundary rectangle to show the supported area
      const boundaryRect = L.rectangle(bounds, {
        color: "#667eea",
        weight: 3,
        fillOpacity: 0.1,
        fillColor: "#667eea",
        dashArray: "10, 10",
      }).addTo(this.map);

      // Add a popup to the boundary explaining the area
      boundaryRect.bindPopup(
        `<strong>${regionConfig.name} Routing Area</strong><br/>This demo supports routing within this highlighted area only.`,
        { closeButton: false }
      );

      // Set max bounds to prevent users from panning too far outside
      this.map.setMaxBounds(bounds.pad(0.5));

      // Ensure the map view fits the region area
      this.map.fitBounds(bounds);
    }

    // Show welcome message
    this.showSuccessMessage(regionConfig.welcomeMessage);

    // Add location control (only if L.Control.Locate is available)
    setTimeout(() => {
      if (typeof L.Control !== "undefined" && L.Control.Locate) {
        this.map.addControl(
          new L.Control.Locate({
            position: "topright",
            strings: {
              title: "Show me where I am",
            },
          })
        );
      }
    }, 100);
  }

  initEventListeners() {
    // Sidebar toggle
    document.getElementById("toggle-sidebar").addEventListener("click", () => {
      document.getElementById("sidebar").classList.toggle("collapsed");
    });

    // Profile buttons
    document.querySelectorAll(".profile-btn").forEach((btn) => {
      btn.addEventListener("click", (e) =>
        this.selectProfile(e.target.closest(".profile-btn"))
      );
    });

    // Feature toggles
    document.querySelectorAll(".toggle-switch").forEach((toggle) => {
      toggle.addEventListener("click", (e) => this.toggleFeature(e.target));
    });

    // Action buttons
    const findRouteBtn = document.getElementById("find-route");
    console.log("Find route button found:", findRouteBtn);
    if (findRouteBtn) {
      findRouteBtn.addEventListener("click", () => {
        console.log("Find route button clicked!");
        this.findRoute();
      });
    } else {
      console.error("Find route button not found!");
    }

    const clearRouteBtn = document.getElementById("clear-route");
    if (clearRouteBtn) {
      clearRouteBtn.addEventListener("click", () => this.clearRoute());
    }

    // Map controls
    document
      .getElementById("locate-btn")
      .addEventListener("click", () => this.locateUser());
    document
      .getElementById("satellite-btn")
      .addEventListener("click", () => this.toggleSatellite());
    document
      .getElementById("traffic-btn")
      .addEventListener("click", () => this.toggleTraffic());
    document
      .getElementById("fullscreen-btn")
      .addEventListener("click", () => this.toggleFullscreen());

    // Search inputs with autocomplete
    const startInput = document.getElementById("start-input");
    const endInput = document.getElementById("end-input");

    startInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.geocodeStart();
    });

    endInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.geocodeEnd();
    });

    // Add input event listeners for autocomplete
    startInput.addEventListener("input", (e) => {
      this.debounceGeocode(e.target.value, "start");
    });

    endInput.addEventListener("input", (e) => {
      this.debounceGeocode(e.target.value, "end");
    });

    // Add keyboard navigation for autocomplete
    startInput.addEventListener("keydown", (e) => {
      this.handleAutocompleteKeydown(e, "start");
    });

    endInput.addEventListener("keydown", (e) => {
      this.handleAutocompleteKeydown(e, "end");
    });

    // Hide autocomplete when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".input-group")) {
        this.hideAutocomplete("start");
        this.hideAutocomplete("end");
      }
    });

    // Add focus handlers
    startInput.addEventListener("focus", () => {
      if (startInput.value.length >= 3) {
        this.showAutocomplete(startInput.value, "start");
      }
    });

    endInput.addEventListener("focus", () => {
      if (endInput.value.length >= 3) {
        this.showAutocomplete(endInput.value, "end");
      }
    });
  }

  initGeocoding() {
    // Get current region configuration
    const regionConfig = getCurrentRegionConfig();

    // Add geocoding control to map with region-specific country codes
    const geocodingParams = {};
    if (regionConfig.geocodingCountries) {
      geocodingParams.countrycodes = regionConfig.geocodingCountries;
    }

    this.geocoder = L.Control.Geocoder.nominatim({
      geocodingQueryParams: geocodingParams,
    });
  }

  // Debounce function for autocomplete
  debounceGeocode(query, type) {
    clearTimeout(this.geocodeTimeout);
    if (query.length > 2) {
      this.geocodeTimeout = setTimeout(() => {
        this.showAutocomplete(query, type);
      }, 300);
    } else {
      this.hideAutocomplete(type);
    }
  }

  async showAutocomplete(query, type) {
    if (query.length < 3) {
      this.hideAutocomplete(type);
      return;
    }

    // Show loading state
    this.showAutocompleteLoading(type);

    try {
      // Get current region configuration for country codes
      const regionConfig = getCurrentRegionConfig();

      // Build the search URL with region-specific country codes
      let searchUrl = `http://localhost:3003/api/v1/search?q=${encodeURIComponent(
        query
      )}&limit=5`;

      if (regionConfig.geocodingCountries) {
        searchUrl += `&countrycodes=${regionConfig.geocodingCountries}`;
      }

      // Use our local API instead of calling Nominatim directly
      const response = await fetch(searchUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.results && data.results.length > 0) {
        this.displayAutocomplete(data.results, type);
      } else {
        this.showAutocompleteNoResults(type);
      }
    } catch (error) {
      console.warn("Autocomplete search failed:", error);
      this.showAutocompleteError(type);
    }
  }

  showAutocompleteLoading(type) {
    const containerId = `${type}-autocomplete`;
    let container = document.getElementById(containerId);

    if (!container) {
      container = document.createElement("div");
      container.id = containerId;
      container.className = "autocomplete-container";

      const input = document.getElementById(`${type}-input`);
      input.parentNode.appendChild(container);
    }

    container.innerHTML = `
      <div class="autocomplete-loading">
        <div class="loading-spinner"></div>
        <span>Searching...</span>
      </div>
    `;
    container.style.display = "block";
  }

  showAutocompleteNoResults(type) {
    const containerId = `${type}-autocomplete`;
    let container = document.getElementById(containerId);

    if (container) {
      container.innerHTML = `
        <div class="autocomplete-no-results">
          <i class="fas fa-search"></i>
          <span>No results found</span>
        </div>
      `;
    }
  }

  showAutocompleteError(type) {
    const containerId = `${type}-autocomplete`;
    let container = document.getElementById(containerId);

    if (container) {
      container.innerHTML = `
        <div class="autocomplete-error">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Search failed. Please try again.</span>
        </div>
      `;
    }
  }

  displayAutocomplete(results, type) {
    const containerId = `${type}-autocomplete`;
    let container = document.getElementById(containerId);

    if (!container) {
      container = document.createElement("div");
      container.id = containerId;
      container.className = "autocomplete-container";

      const input = document.getElementById(`${type}-input`);
      input.parentNode.appendChild(container);
    }

    container.innerHTML = "";

    results.forEach((result, index) => {
      const item = document.createElement("div");
      item.className = "autocomplete-item";
      if (index === 0) item.classList.add("highlighted");

      // Handle the new API response format
      const displayName = result.display_name;
      const lat = result.lat;
      const lng = result.lng;

      // Truncate long display names
      const shortName =
        displayName.length > 60
          ? displayName.substring(0, 60) + "..."
          : displayName;

      item.innerHTML = `
        <div class="autocomplete-content">
          <div class="autocomplete-main">
            <i class="fas fa-map-marker-alt"></i>
            <span>${shortName}</span>
          </div>
          <div class="autocomplete-details">
            ${result.type || ""} ${result.class ? "• " + result.class : ""}
          </div>
        </div>
      `;

      item.addEventListener("click", () => {
        document.getElementById(`${type}-input`).value = displayName;

        if (type === "start") {
          this.setStartPoint(lat, lng);
        } else {
          this.setEndPoint(lat, lng);
          if (this.startMarker) {
            this.findRoute();
          }
        }

        this.map.setView([lat, lng], 15);
        this.hideAutocomplete(type);
      });

      container.appendChild(item);
    });

    container.style.display = "block";
  }

  hideAutocomplete(type) {
    const containerId = `${type}-autocomplete`;
    const container = document.getElementById(containerId);
    if (container) {
      container.style.display = "none";
    }
  }

  handleMapClick(e) {
    const { lat, lng } = e.latlng;

    // Get current region configuration
    const regionConfig = getCurrentRegionConfig();

    // Only validate bounds if the region restricts bounds (like Berlin)
    if (regionConfig.restrictBounds && regionConfig.bounds) {
      const bounds = regionConfig.bounds;

      if (
        lat < bounds.southwest[0] ||
        lat > bounds.northeast[0] ||
        lng < bounds.southwest[1] ||
        lng > bounds.northeast[1]
      ) {
        this.showErrorMessage(
          `Please click within the ${regionConfig.name} area. This demo supports routing within ${regionConfig.name}.`
        );
        return;
      }
    }

    if (!this.startMarker) {
      this.setStartPoint(lat, lng);
      this.reverseGeocode(lat, lng, "start-input");
    } else if (!this.endMarker) {
      this.setEndPoint(lat, lng);
      this.reverseGeocode(lat, lng, "end-input");
      this.findRoute();
    } else {
      // Reset and set new start point
      this.clearRoute();
      this.setStartPoint(lat, lng);
      this.reverseGeocode(lat, lng, "start-input");
    }
  }

  setStartPoint(lat, lng) {
    if (this.startMarker) {
      this.map.removeLayer(this.startMarker);
    }

    this.startMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "start-marker",
        html: '<i class="fas fa-play-circle" style="color: #28a745; font-size: 24px;"></i>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).addTo(this.map);
  }

  setEndPoint(lat, lng) {
    if (this.endMarker) {
      this.map.removeLayer(this.endMarker);
    }

    this.endMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "end-marker",
        html: '<i class="fas fa-flag-checkered" style="color: #dc3545; font-size: 24px;"></i>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    }).addTo(this.map);
  }

  async reverseGeocode(lat, lng, inputId) {
    try {
      // Use our local API instead of calling Nominatim directly
      const response = await fetch(
        `http://localhost:3003/api/v1/reverse?lat=${lat}&lng=${lng}&zoom=18`
      );
      const data = await response.json();

      if (data.display_name) {
        document.getElementById(inputId).value = data.display_name;
      }
    } catch (error) {
      console.warn("Reverse geocoding failed:", error);
    }
  }

  async geocodeStart() {
    const address = document.getElementById("start-input").value;
    const coords = await this.geocodeAddress(address);
    if (coords) {
      this.setStartPoint(coords.lat, coords.lng);
      this.map.setView([coords.lat, coords.lng], 15);
    }
  }

  async geocodeEnd() {
    const address = document.getElementById("end-input").value;
    const coords = await this.geocodeAddress(address);
    if (coords) {
      this.setEndPoint(coords.lat, coords.lng);
      this.map.setView([coords.lat, coords.lng], 15);
      if (this.startMarker) {
        this.findRoute();
      }
    }
  }

  async geocodeAddress(address) {
    try {
      // Use our local API instead of calling Nominatim directly
      const response = await fetch(
        `http://localhost:3003/api/v1/search?q=${encodeURIComponent(
          address
        )}&limit=1`
      );
      const data = await response.json();

      if (data.results && data.results.length > 0) {
        const result = data.results[0];
        return {
          lat: result.lat,
          lng: result.lng,
        };
      }
    } catch (error) {
      this.showErrorMessage("Geocoding failed. Please try again.");
    }
    return null;
  }

  selectProfile(button) {
    document
      .querySelectorAll(".profile-btn")
      .forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    this.currentProfile = button.dataset.profile;

    // Re-calculate route if exists
    if (this.currentRoute) {
      this.findRoute();
    }
  }

  toggleFeature(toggle) {
    toggle.classList.toggle("active");
    const feature = toggle.dataset.feature;
    this.features[feature] = toggle.classList.contains("active");

    // Handle special features
    if (
      feature === "isochrones" &&
      this.features[feature] &&
      this.startMarker
    ) {
      this.generateIsochrones();
    } else if (feature === "isochrones" && !this.features[feature]) {
      this.clearIsochrones();
    }

    // Re-calculate route if exists
    if (
      this.currentRoute &&
      ["alternatives", "steps", "traffic"].includes(feature)
    ) {
      this.findRoute();
    }
  }

  async findRoute() {
    console.log("=== FINDROUTE DEBUG START ===");
    console.log("findRoute() called");
    console.log("Start marker:", this.startMarker);
    console.log("End marker:", this.endMarker);

    if (!this.startMarker || !this.endMarker) {
      console.log("Missing markers - showing error message");
      this.showErrorMessage("Please select both start and end points");
      return;
    }

    console.log("Starting route calculation...");
    this.showLoading(true);

    try {
      console.log("About to start validation...");

      // Get coordinates
      const startCoords = this.startMarker.getLatLng();
      const endCoords = this.endMarker.getLatLng();

      console.log("Checking if coordinates are valid for routing...");

      // Remove geographic restrictions - allow routing anywhere in the loaded region
      console.log(
        "Coordinates are valid, proceeding with route calculation..."
      );

      console.log("About to call calculateRoute with coordinates:");
      console.log("Start: [", startCoords.lng, ",", startCoords.lat, "]");
      console.log("End: [", endCoords.lng, ",", endCoords.lat, "]");

      console.log("Calling calculateRoute...");
      const routeData = await this.calculateRoute(
        [startCoords.lng, startCoords.lat],
        [endCoords.lng, endCoords.lat]
      );

      console.log("Route data received:", routeData);

      if (routeData && routeData.routes && routeData.routes.length > 0) {
        this.displayRoute(routeData);
        this.showRouteInfo(routeData.routes[0]);
        this.showSuccessMessage("Route calculated successfully!");
      } else {
        this.showErrorMessage("No route found between these points");
      }
    } catch (error) {
      console.error("Route calculation error:", error);

      // Handle different types of errors
      if (error.message.includes("400")) {
        this.showErrorMessage(
          "Invalid route request. Please select points within Berlin, Germany."
        );
      } else if (error.message.includes("500")) {
        this.showErrorMessage("Server error. Please try again in a moment.");
      } else {
        this.showErrorMessage("Failed to calculate route. Please try again.");
      }
    } finally {
      this.showLoading(false);
      console.log("=== FINDROUTE DEBUG END ===");
    }
  }

  async calculateRoute(start, end) {
    console.log("=== CALCULATEROUTE DEBUG START ===");
    console.log("calculateRoute called with:", { start, end });

    const coordinates = [start, end];
    console.log("Coordinates array:", coordinates);

    const requestBody = {
      coordinates,
      profile: this.currentProfile,
      alternatives: this.features.alternatives,
      steps: this.features.steps,
      geometries: document.getElementById("geometry-format").value,
      overview: document.getElementById("overview-level").value,
      annotations: ["duration", "distance", "speed"],
    };

    console.log("Request body:", JSON.stringify(requestBody, null, 2));
    console.log(
      "Making fetch request to: http://localhost:3003/api/v2/route/advanced"
    );

    const response = await fetch(
      "http://localhost:3003/api/v2/route/advanced",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    console.log("Response received:", response);
    console.log("Response status:", response.status);
    console.log("Response ok:", response.ok);

    if (!response.ok) {
      console.log("Response not ok, handling error...");
      // Handle different error types
      if (response.status === 400) {
        const errorData = await response.json();
        console.log("400 error data:", errorData);
        if (
          errorData.error &&
          errorData.error.includes("outside the supported area")
        ) {
          throw new Error(
            "Please select points within Berlin, Germany. This demo only supports routing in the Berlin area."
          );
        } else {
          throw new Error(errorData.error || "Invalid route request");
        }
      } else if (response.status === 500) {
        throw new Error("Server error. Please try again in a moment.");
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const responseData = await response.json();
    console.log("Response data:", responseData);
    console.log("=== CALCULATEROUTE DEBUG END ===");
    return responseData;
  }

  displayRoute(routeData) {
    // Clear existing route
    if (this.currentRoute) {
      this.map.removeLayer(this.currentRoute);
    }

    const route = routeData.routes[0];
    let coordinates;

    // Handle different geometry formats
    if (route.geometry.type === "LineString") {
      // GeoJSON format
      coordinates = route.geometry.coordinates.map((coord) => [
        coord[1],
        coord[0],
      ]);
    } else if (typeof route.geometry === "string") {
      // Polyline format
      coordinates = this.decodePolyline(route.geometry);
    }

    // Create route polyline
    this.currentRoute = L.polyline(coordinates, {
      color: "#667eea",
      weight: 6,
      opacity: 0.8,
    }).addTo(this.map);

    // Add alternative routes if available
    if (this.features.alternatives && routeData.routes.length > 1) {
      routeData.routes.slice(1).forEach((altRoute, index) => {
        let altCoordinates;
        if (altRoute.geometry.type === "LineString") {
          altCoordinates = altRoute.geometry.coordinates.map((coord) => [
            coord[1],
            coord[0],
          ]);
        } else {
          altCoordinates = this.decodePolyline(altRoute.geometry);
        }

        L.polyline(altCoordinates, {
          color: "#95a5a6",
          weight: 4,
          opacity: 0.6,
          dashArray: "10, 10",
        }).addTo(this.map);
      });
    }

    // Fit map to route bounds
    const group = new L.featureGroup([
      this.currentRoute,
      this.startMarker,
      this.endMarker,
    ]);
    this.map.fitBounds(group.getBounds().pad(0.1));
  }

  showRouteInfo(route) {
    const routeInfo = document.getElementById("route-info");

    // Update basic stats
    document.getElementById("route-distance").textContent = this.formatDistance(
      route.distance
    );
    document.getElementById("route-duration").textContent = this.formatDuration(
      route.duration
    );

    // Update enhanced stats if available
    if (route.enhanced) {
      document.getElementById(
        "fuel-cost"
      ).textContent = `$${route.enhanced.estimated_fuel_cost.toFixed(2)}`;
      document.getElementById("carbon-footprint").textContent =
        route.enhanced.carbon_footprint.toFixed(2);
    } else {
      document.getElementById("fuel-cost").textContent = "-";
      document.getElementById("carbon-footprint").textContent = "-";
    }

    // Show turn-by-turn instructions
    if (this.features.steps && route.legs && route.legs[0].steps) {
      this.displayInstructions(route.legs[0].steps);
    }

    routeInfo.classList.add("visible");
  }

  displayInstructions(steps) {
    const instructionsContainer = document.getElementById("route-instructions");
    instructionsContainer.innerHTML =
      '<h4><i class="fas fa-list"></i> Turn-by-Turn Directions</h4>';

    const instructionsList = document.createElement("div");
    instructionsList.style.maxHeight = "200px";
    instructionsList.style.overflowY = "auto";
    instructionsList.style.marginTop = "10px";

    steps.forEach((step, index) => {
      const instruction = document.createElement("div");
      instruction.style.padding = "8px";
      instruction.style.borderBottom = "1px solid #eee";
      instruction.style.fontSize = "14px";

      const icon = this.getInstructionIcon(step.maneuver.type);
      const distance = this.formatDistance(step.distance);
      const duration = this.formatDuration(step.duration);

      instruction.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas ${icon}" style="color: #667eea; width: 20px;"></i>
                    <div style="flex: 1;">
                        <div style="font-weight: 600;">${
                          step.maneuver.instruction || "Continue"
                        }</div>
                        <div style="color: #666; font-size: 12px;">${distance} • ${duration}</div>
                    </div>
                </div>
            `;

      instructionsList.appendChild(instruction);
    });

    instructionsContainer.appendChild(instructionsList);
  }

  getInstructionIcon(maneuverType) {
    const icons = {
      "turn-right": "fa-arrow-right",
      "turn-left": "fa-arrow-left",
      "turn-slight-right": "fa-arrow-right",
      "turn-slight-left": "fa-arrow-left",
      "turn-sharp-right": "fa-arrow-right",
      "turn-sharp-left": "fa-arrow-left",
      continue: "fa-arrow-up",
      merge: "fa-code-branch",
      roundabout: "fa-circle",
      depart: "fa-play",
      arrive: "fa-flag-checkered",
    };
    return icons[maneuverType] || "fa-arrow-up";
  }

  async generateIsochrones() {
    if (!this.startMarker) {
      this.showErrorMessage("Please select a start point first");
      return;
    }

    try {
      const startCoords = this.startMarker.getLatLng();

      // Validate coordinates are in Berlin area
      const berlinBounds = {
        minLat: 52.3,
        maxLat: 52.7,
        minLng: 13.0,
        maxLng: 13.8,
      };

      if (
        startCoords.lat < berlinBounds.minLat ||
        startCoords.lat > berlinBounds.maxLat ||
        startCoords.lng < berlinBounds.minLng ||
        startCoords.lng > berlinBounds.maxLng
      ) {
        this.showErrorMessage(
          "Isochrones can only be generated for points within Berlin area"
        );
        return;
      }

      const contours = [300, 600, 900, 1200]; // 5, 10, 15, 20 minutes

      const response = await fetch("http://localhost:3003/api/v2/isochrone", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: [startCoords.lng, startCoords.lat], // [lng, lat] format
          contours: contours,
          profile: this.currentProfile,
        }),
      });

      if (!response.ok) {
        if (response.status === 400) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Invalid isochrone request");
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      const data = await response.json();

      if (data.features) {
        this.displayIsochrones(data.features);
        this.showSuccessMessage("Isochrones generated successfully!");
      } else {
        this.showErrorMessage("No isochrone data received");
      }
    } catch (error) {
      console.error("Isochrone generation error:", error);
      this.showErrorMessage(error.message || "Failed to generate isochrones");
    }
  }

  displayIsochrones(features) {
    this.clearIsochrones();

    const colors = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4"];

    features.forEach((feature, index) => {
      if (feature.geometry) {
        const polygon = L.geoJSON(feature.geometry, {
          style: {
            color: colors[index % colors.length],
            fillColor: colors[index % colors.length],
            fillOpacity: 0.2,
            weight: 2,
          },
        }).addTo(this.map);

        this.isochrones.push(polygon);
      }
    });
  }

  clearIsochrones() {
    this.isochrones.forEach((iso) => this.map.removeLayer(iso));
    this.isochrones = [];
  }

  clearRoute() {
    if (this.currentRoute) {
      this.map.removeLayer(this.currentRoute);
      this.currentRoute = null;
    }

    if (this.startMarker) {
      this.map.removeLayer(this.startMarker);
      this.startMarker = null;
    }

    if (this.endMarker) {
      this.map.removeLayer(this.endMarker);
      this.endMarker = null;
    }

    this.clearIsochrones();

    document.getElementById("start-input").value = "";
    document.getElementById("end-input").value = "";
    document.getElementById("route-info").classList.remove("visible");
  }

  locateUser() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          this.map.setView([latitude, longitude], 15);
          this.setStartPoint(latitude, longitude);
          this.reverseGeocode(latitude, longitude, "start-input");
        },
        (error) => {
          this.showErrorMessage("Unable to get your location");
        }
      );
    } else {
      this.showErrorMessage("Geolocation is not supported by this browser");
    }
  }

  toggleSatellite() {
    if (this.map.hasLayer(this.satelliteLayer)) {
      this.map.removeLayer(this.satelliteLayer);
      this.map.addLayer(this.osmLayer);
    } else {
      this.map.removeLayer(this.osmLayer);
      this.map.addLayer(this.satelliteLayer);
    }
  }

  toggleTraffic() {
    // Toggle traffic feature
    this.features.traffic = !this.features.traffic;
    const trafficBtn = document.getElementById("traffic-btn");

    if (this.features.traffic) {
      trafficBtn.style.backgroundColor = "#667eea";
      trafficBtn.style.color = "white";
      this.showSuccessMessage("Traffic avoidance enabled");

      // Re-calculate route if exists
      if (this.currentRoute) {
        this.findRoute();
      }
    } else {
      trafficBtn.style.backgroundColor = "white";
      trafficBtn.style.color = "#333";
      this.showSuccessMessage("Traffic avoidance disabled");

      // Re-calculate route if exists
      if (this.currentRoute) {
        this.findRoute();
      }
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  // Utility functions
  formatDistance(meters) {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    } else {
      return `${(meters / 1000).toFixed(1)} km`;
    }
  }

  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  decodePolyline(encoded) {
    // Simple polyline decoder
    const coordinates = [];
    let index = 0,
      lat = 0,
      lng = 0;

    while (index < encoded.length) {
      let b,
        shift = 0,
        result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      coordinates.push([lat / 1e5, lng / 1e5]);
    }

    return coordinates;
  }

  showLoading(show) {
    console.log("showLoading called with:", show);
    let loadingOverlay = document.getElementById("route-loading-overlay");

    if (show) {
      console.log("Showing loading overlay...");
      if (!loadingOverlay) {
        console.log("Creating new loading overlay...");
        loadingOverlay = document.createElement("div");
        loadingOverlay.id = "route-loading-overlay";
        loadingOverlay.className = "route-loading";
        loadingOverlay.innerHTML = `
          <div class="route-loading-content">
            <div class="route-loading-spinner"></div>
            <span>Calculating route...</span>
          </div>
        `;
        document.body.appendChild(loadingOverlay);
        console.log("Loading overlay created and added to body");
      }
      loadingOverlay.style.display = "flex";
      console.log("Loading overlay display set to flex");
    } else {
      console.log("Hiding loading overlay...");
      if (loadingOverlay) {
        loadingOverlay.style.display = "none";
        console.log("Loading overlay hidden");
      } else {
        console.log("No loading overlay found to hide");
      }
    }
  }

  showErrorMessage(message) {
    this.showMessage(message, "error");
  }

  showSuccessMessage(message) {
    this.showMessage(message, "success");
  }

  showMessage(message, type) {
    console.log("=== SHOWMESSAGE DEBUG ===");
    console.log("showMessage called with:", { message, type });

    // Remove existing messages
    const existingMessages = document.querySelectorAll(".message");
    console.log("Found existing messages:", existingMessages.length);
    existingMessages.forEach((msg) => msg.remove());

    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${type}-message`;
    messageDiv.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <i class="fas ${
          type === "error" ? "fa-exclamation-circle" : "fa-check-circle"
        }"></i>
        <span>${message}</span>
      </div>
    `;

    console.log("Created message div:", messageDiv);
    console.log("Message div className:", messageDiv.className);
    console.log("Message div innerHTML:", messageDiv.innerHTML);

    document.body.appendChild(messageDiv);
    console.log("Message div appended to body");

    // Check if the element is actually in the DOM
    const addedElement = document.querySelector(`.${type}-message`);
    console.log("Element found in DOM after adding:", addedElement);

    if (addedElement) {
      const computedStyle = window.getComputedStyle(addedElement);
      console.log("Element computed styles:", {
        position: computedStyle.position,
        top: computedStyle.top,
        right: computedStyle.right,
        zIndex: computedStyle.zIndex,
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        opacity: computedStyle.opacity,
      });
    }

    // Auto-hide after delay
    setTimeout(
      () => {
        if (messageDiv.parentNode) {
          console.log("Auto-hiding message after delay");
          messageDiv.style.animation = "slideOutRight 0.3s ease-in forwards";
          setTimeout(() => {
            console.log("Removing message element");
            messageDiv.remove();
          }, 300);
        }
      },
      type === "error" ? 5000 : 3000
    );

    console.log("=== SHOWMESSAGE DEBUG END ===");
  }

  handleAutocompleteKeydown(e, type) {
    if (e.key === "ArrowDown") {
      const container = document.getElementById(`${type}-autocomplete`);
      const items = container.querySelectorAll(".autocomplete-item");
      const selectedIndex = Array.from(items).indexOf(e.target);
      if (selectedIndex > -1 && selectedIndex < items.length - 1) {
        items[selectedIndex].classList.remove("highlighted");
        items[selectedIndex + 1].classList.add("highlighted");
      }
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      const container = document.getElementById(`${type}-autocomplete`);
      const items = container.querySelectorAll(".autocomplete-item");
      const selectedIndex = Array.from(items).indexOf(e.target);
      if (selectedIndex > 0) {
        items[selectedIndex].classList.remove("highlighted");
        items[selectedIndex - 1].classList.add("highlighted");
      }
      e.preventDefault();
    } else if (e.key === "Enter") {
      const selectedItem = e.target.closest(".autocomplete-item");
      if (selectedItem) {
        const input = document.getElementById(`${type}-input`);
        input.value = selectedItem.querySelector(
          ".autocomplete-main span"
        ).textContent;
        this.hideAutocomplete(type);
      }
    }
  }

  setDefaultRegionLocations() {
    // Get current region configuration
    const regionConfig = getCurrentRegionConfig();

    // Set region-specific default locations and placeholders
    let defaultLocations, startPlaceholder, endPlaceholder;

    switch (OSRM_CONFIG.REGION) {
      case "berlin":
        defaultLocations = {
          start: {
            name: "Brandenburg Gate, Berlin",
            lat: 52.5163,
            lng: 13.3777,
          },
          end: { name: "Alexanderplatz, Berlin", lat: 52.5219, lng: 13.4132 },
        };
        startPlaceholder =
          "Try: Brandenburg Gate, Potsdamer Platz, Alexanderplatz...";
        endPlaceholder = "Try: Berlin locations within the city...";
        break;

      case "india":
        defaultLocations = {
          start: { name: "India Gate, New Delhi", lat: 28.6129, lng: 77.2295 },
          end: { name: "Red Fort, New Delhi", lat: 28.6562, lng: 77.241 },
        };
        startPlaceholder = "Try: India Gate, Mumbai, Bangalore, Chennai...";
        endPlaceholder = "Try: Any location in India...";
        break;

      case "asia":
        defaultLocations = {
          start: { name: "Tokyo, Japan", lat: 35.6762, lng: 139.6503 },
          end: { name: "Seoul, South Korea", lat: 37.5665, lng: 126.978 },
        };
        startPlaceholder = "Try: Tokyo, Seoul, Bangkok, Singapore, Mumbai...";
        endPlaceholder = "Try: Any location in Asia...";
        break;

      case "world":
        defaultLocations = {
          start: { name: "Times Square, New York", lat: 40.758, lng: -73.9855 },
          end: { name: "Eiffel Tower, Paris", lat: 48.8584, lng: 2.2945 },
        };
        startPlaceholder = "Try: Any city or landmark worldwide...";
        endPlaceholder = "Try: Any global destination...";
        break;

      default:
        defaultLocations = {
          start: {
            name: "Start Location",
            lat: regionConfig.center[0],
            lng: regionConfig.center[1],
          },
          end: {
            name: "End Location",
            lat: regionConfig.center[0] + 0.01,
            lng: regionConfig.center[1] + 0.01,
          },
        };
        startPlaceholder = `Try: Locations in ${regionConfig.name}...`;
        endPlaceholder = `Try: Destinations in ${regionConfig.name}...`;
    }

    // Set placeholders in inputs
    document.getElementById("start-input").placeholder = startPlaceholder;
    document.getElementById("end-input").placeholder = endPlaceholder;

    // Optionally set default markers (commented out to let users explore)
    // this.setStartPoint(defaultLocations.start.lat, defaultLocations.start.lng);
    // this.setEndPoint(defaultLocations.end.lat, defaultLocations.end.lng);
    // document.getElementById("start-input").value = defaultLocations.start.name;
    // document.getElementById("end-input").value = defaultLocations.end.name;
  }
}

// Initialize the application when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.osrmApp = new OSRMEnterpriseApp();
});

// Add some global utility functions
window.addEventListener("resize", () => {
  if (window.osrmApp && window.osrmApp.map) {
    window.osrmApp.map.invalidateSize();
  }
});

// Service Worker registration for offline capabilities
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("SW registered: ", registration);
      })
      .catch((registrationError) => {
        console.log("SW registration failed: ", registrationError);
      });
  });
}
