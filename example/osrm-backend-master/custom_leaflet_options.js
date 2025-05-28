"use strict";

var L = require("leaflet");

var osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright/en">OpenStreetMap</a> contributors',
  }),
  osm_de = L.tileLayer(
    "https://{s}.tile.openstreetmap.de/tiles/osmde/{z}/{x}/{y}.png",
    {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright/en">OpenStreetMap</a> contributors',
    }
  ),
  cartodb = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }
  ),
  small_components = L.tileLayer(
    "https://tools.geofabrik.de/osmi/tiles/routing_i/{z}/{x}/{y}.png",
    {}
  );

module.exports = {
  defaultState: {
    center: L.latLng(43.7384, 7.4246), // Monaco coordinates
    zoom: 13,
    waypoints: [],
    language: "en",
    alternative: 0,
    layer: osm, // Use OpenStreetMap by default
  },
  services: [
    {
      label: "Car (fastest)",
      path: "http://localhost:5003/route/v1", // Updated to use our port
    },
  ],
  layer: [
    {
      OpenStreetMap: osm,
      "OpenStreetMap DE": osm_de,
      "CartoDB Light": cartodb,
    },
  ],
  overlay: {
    "Small Components": small_components,
  },
  baselayer: {
    one: osm,
    two: osm_de,
    three: cartodb,
  },
};
