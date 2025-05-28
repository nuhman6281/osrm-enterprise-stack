// OSRM Enterprise Maps Service Worker
const CACHE_NAME = "osrm-enterprise-v2.0.0";
const STATIC_CACHE = "osrm-static-v2.0.0";
const TILES_CACHE = "osrm-tiles-v2.0.0";
const API_CACHE = "osrm-api-v2.0.0";

// Resources to cache immediately
const STATIC_RESOURCES = [
  "/",
  "/index.html",
  "/app.js",
  "/manifest.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css",
  "https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js",
  "https://unpkg.com/leaflet-control-geocoder@2.4.0/dist/Control.Geocoder.css",
  "https://unpkg.com/leaflet-control-geocoder@2.4.0/dist/Control.Geocoder.js",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
];

// Install event - cache static resources
self.addEventListener("install", (event) => {
  console.log("Service Worker installing...");

  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => {
        console.log("Caching static resources...");
        return cache.addAll(
          STATIC_RESOURCES.map((url) => new Request(url, { mode: "cors" }))
        );
      }),
      caches.open(TILES_CACHE),
      caches.open(API_CACHE),
    ])
      .then(() => {
        console.log("Service Worker installed successfully");
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error("Service Worker installation failed:", error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("Service Worker activating...");

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (
              cacheName !== STATIC_CACHE &&
              cacheName !== TILES_CACHE &&
              cacheName !== API_CACHE
            ) {
              console.log("Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log("Service Worker activated");
        return self.clients.claim();
      })
  );
});

// Fetch event - handle requests with caching strategies
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle different types of requests with appropriate caching strategies
  if (isStaticResource(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (isTileRequest(url)) {
    event.respondWith(cacheFirst(request, TILES_CACHE));
  } else if (isAPIRequest(url)) {
    event.respondWith(networkFirst(request, API_CACHE));
  } else if (isGeocodingRequest(url)) {
    event.respondWith(networkFirst(request, API_CACHE));
  } else {
    event.respondWith(networkFirst(request, CACHE_NAME));
  }
});

// Cache-first strategy (good for static resources)
async function cacheFirst(request, cacheName) {
  try {
    // Skip caching for chrome-extension and other unsupported schemes
    const url = new URL(request.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fetch(request);
    }

    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      // Return cached version and update in background
      updateCache(request, cacheName);
      return cachedResponse;
    }

    // Not in cache, fetch from network
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache successful responses
      const responseClone = networkResponse.clone();
      cache.put(request, responseClone);
    }

    return networkResponse;
  } catch (error) {
    console.error("Cache-first strategy failed:", error);
    return new Response("Offline - Resource not available", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

// Network-first strategy (good for API requests)
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache successful responses
      const cache = await caches.open(cacheName);
      const responseClone = networkResponse.clone();

      // Don't cache POST requests or very large responses
      if (
        request.method === "GET" &&
        networkResponse.headers.get("content-length") < 1000000
      ) {
        cache.put(request, responseClone);
      }
    }

    return networkResponse;
  } catch (error) {
    console.log("Network failed, trying cache:", error);

    // Network failed, try cache
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline response for API requests
    if (isAPIRequest(new URL(request.url))) {
      return new Response(
        JSON.stringify({
          error: "Offline",
          message: "This feature requires an internet connection",
          offline: true,
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response("Offline - Resource not available", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

// Background cache update
async function updateCache(request, cacheName) {
  try {
    const cache = await caches.open(cacheName);
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      cache.put(request, networkResponse);
    }
  } catch (error) {
    // Silently fail background updates
    console.log("Background cache update failed:", error);
  }
}

// Helper functions to identify request types
function isStaticResource(url) {
  return (
    STATIC_RESOURCES.some((resource) => url.href.includes(resource)) ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.endsWith(".woff2")
  );
}

function isTileRequest(url) {
  return (
    url.hostname.includes("tile.openstreetmap.org") ||
    url.hostname.includes("arcgisonline.com") ||
    url.pathname.includes("/tiles/") ||
    url.pathname.match(/\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)$/)
  );
}

function isAPIRequest(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.hostname === window.location.hostname
  );
}

function isGeocodingRequest(url) {
  return (
    url.hostname.includes("nominatim.openstreetmap.org") ||
    url.pathname.includes("/geocode") ||
    url.pathname.includes("/search") ||
    url.pathname.includes("/reverse")
  );
}

// Handle background sync for offline route requests
self.addEventListener("sync", (event) => {
  if (event.tag === "route-sync") {
    event.waitUntil(syncOfflineRoutes());
  }
});

async function syncOfflineRoutes() {
  try {
    // Get offline route requests from IndexedDB
    const offlineRequests = await getOfflineRequests();

    for (const request of offlineRequests) {
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        });

        if (response.ok) {
          // Process successful response
          await processOfflineRouteResponse(request.id, response);
          await removeOfflineRequest(request.id);
        }
      } catch (error) {
        console.log("Sync failed for request:", request.id, error);
      }
    }
  } catch (error) {
    console.error("Background sync failed:", error);
  }
}

// IndexedDB helpers for offline functionality
async function getOfflineRequests() {
  // Simplified - in production, use proper IndexedDB implementation
  return [];
}

async function processOfflineRouteResponse(requestId, response) {
  // Process the response and notify the client
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({
      type: "ROUTE_SYNC_SUCCESS",
      requestId,
      data: response,
    });
  });
}

async function removeOfflineRequest(requestId) {
  // Remove from IndexedDB
  console.log("Removing offline request:", requestId);
}

// Handle push notifications for route updates
self.addEventListener("push", (event) => {
  if (event.data) {
    const data = event.data.json();

    const options = {
      body: data.body || "Route update available",
      icon: "/icons/icon-192x192.png",
      badge: "/icons/badge-72x72.png",
      tag: "route-update",
      data: data.data || {},
      actions: [
        {
          action: "view",
          title: "View Route",
          icon: "/icons/view-icon.png",
        },
        {
          action: "dismiss",
          title: "Dismiss",
          icon: "/icons/dismiss-icon.png",
        },
      ],
    };

    event.waitUntil(
      self.registration.showNotification(
        data.title || "OSRM Enterprise",
        options
      )
    );
  }
});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "view") {
    event.waitUntil(clients.openWindow("/"));
  }
});

// Message handling for communication with main thread
self.addEventListener("message", (event) => {
  const { type, data } = event.data;

  switch (type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    case "CACHE_ROUTE":
      cacheRouteData(data);
      break;

    case "CLEAR_CACHE":
      clearAllCaches();
      break;

    case "GET_CACHE_STATUS":
      getCacheStatus().then((status) => {
        event.ports[0].postMessage(status);
      });
      break;
  }
});

async function cacheRouteData(routeData) {
  try {
    const cache = await caches.open(API_CACHE);
    const response = new Response(JSON.stringify(routeData), {
      headers: { "Content-Type": "application/json" },
    });

    await cache.put(`/offline-route-${Date.now()}`, response);
    console.log("Route data cached for offline use");
  } catch (error) {
    console.error("Failed to cache route data:", error);
  }
}

async function clearAllCaches() {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    console.log("All caches cleared");
  } catch (error) {
    console.error("Failed to clear caches:", error);
  }
}

async function getCacheStatus() {
  try {
    const cacheNames = await caches.keys();
    const status = {};

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      status[cacheName] = keys.length;
    }

    return status;
  } catch (error) {
    console.error("Failed to get cache status:", error);
    return {};
  }
}

console.log("OSRM Enterprise Service Worker loaded");
