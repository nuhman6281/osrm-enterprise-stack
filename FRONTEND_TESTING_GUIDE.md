# 🧪 OSRM Enterprise Frontend Testing Guide

## Open http://localhost:9966 in your browser and follow this comprehensive checklist:

---

## ✅ **1. BASIC INTERFACE TESTS**

### Initial Load:

- [ ] Page loads without errors
- [ ] Map is centered on Berlin (52.52, 13.405)
- [ ] Sidebar is visible on the left with "OSRM Enterprise" header
- [ ] Map controls are visible on the right side
- [ ] Success message appears: "OSRM Enterprise Maps loaded successfully!"
- [ ] No console errors in browser dev tools (F12)

### UI Elements:

- [ ] Sidebar contains: Search inputs, Transportation modes, Features toggles, Advanced options
- [ ] Map controls include: Location, Satellite, Traffic, Fullscreen buttons
- [ ] Hamburger menu button (☰) is visible in top-left

---

## ✅ **2. MAP INTERACTION TESTS**

### Basic Map Functions:

- [ ] **Zoom In/Out**: Mouse wheel or +/- buttons work
- [ ] **Pan**: Click and drag to move map around
- [ ] **Click to Route**: Click anywhere on map to set start point
- [ ] **Second Click**: Click again to set end point and auto-calculate route

### Map Controls:

- [ ] **Location Button** (🎯): Click to center map on your location (if location permission granted)
- [ ] **Satellite Button** (🛰️): Toggle between street map and satellite imagery
- [ ] **Traffic Button** (🚦): Toggle traffic layer (visual indicator)
- [ ] **Fullscreen Button** (⛶): Enter/exit fullscreen mode
- [ ] **Sidebar Toggle** (☰): Hide/show sidebar

---

## ✅ **3. ROUTING FUNCTIONALITY TESTS**

### Manual Route Creation:

1. **Click Method**:

   - [ ] Click on map to set start point (green play icon appears)
   - [ ] Click elsewhere to set end point (red flag icon appears)
   - [ ] Route automatically calculates and displays
   - [ ] Route info panel appears with statistics

2. **Search Method**:
   - [ ] Type address in "From" field (e.g., "Brandenburg Gate, Berlin")
   - [ ] Press Enter or click elsewhere
   - [ ] Start marker appears on map
   - [ ] Type address in "To" field (e.g., "Berlin Cathedral")
   - [ ] Press Enter
   - [ ] End marker appears and route calculates

### Route Information Display:

- [ ] **Distance**: Shows in km (e.g., "2.5 km")
- [ ] **Duration**: Shows in minutes (e.g., "8 min")
- [ ] **Fuel Cost**: Shows estimated cost (e.g., "$0.45")
- [ ] **CO₂ Emissions**: Shows carbon footprint (e.g., "0.3 kg")
- [ ] **Turn-by-turn instructions**: Detailed step list with icons

---

## ✅ **4. TRANSPORTATION MODE TESTS**

Test each transportation profile:

### Car Mode (🚗):

- [ ] Click "Car" button (should be active by default)
- [ ] Create a route
- [ ] Verify route follows roads suitable for cars
- [ ] Check fuel cost is calculated (non-zero)

### Bicycle Mode (🚴):

- [ ] Click "Bike" button
- [ ] Create same route
- [ ] Verify route may differ from car route
- [ ] Check fuel cost shows $0.00
- [ ] Duration should be longer than car

### Walking Mode (🚶):

- [ ] Click "Walk" button
- [ ] Create same route
- [ ] Verify route allows pedestrian paths
- [ ] Check fuel cost shows $0.00
- [ ] Duration should be longest

---

## ✅ **5. FEATURE TOGGLES TESTS**

### Alternative Routes:

- [ ] Toggle "Alternative Routes" ON
- [ ] Create a route
- [ ] Verify multiple route options appear (if available)
- [ ] Click different routes to select them

### Turn-by-Turn Navigation:

- [ ] Toggle "Turn-by-Turn" OFF
- [ ] Create route - instructions should be minimal
- [ ] Toggle ON - detailed instructions should appear
- [ ] Verify instruction icons match maneuver types

### Traffic Avoidance:

- [ ] Toggle "Traffic Avoidance" ON/OFF
- [ ] Visual indicator should change
- [ ] Route may recalculate (simulated feature)

### Isochrones:

- [ ] Toggle "Isochrones" ON
- [ ] Click on map
- [ ] Verify colored areas appear showing reachable zones
- [ ] Toggle OFF - isochrones should disappear

---

## ✅ **6. ADVANCED OPTIONS TESTS**

### Geometry Format:

- [ ] Change from "GeoJSON" to "Polyline"
- [ ] Create route - should still work
- [ ] Try "Polyline6" option

### Overview Level:

- [ ] Test "Full" - detailed route geometry
- [ ] Test "Simplified" - less detailed
- [ ] Test "None" - minimal geometry

---

## ✅ **7. ACTION BUTTONS TESTS**

### Find Route Button:

- [ ] Set start and end points manually
- [ ] Click "Find Route" button
- [ ] Route should calculate and display

### Clear Route Button:

- [ ] Create any route
- [ ] Click "Clear" button
- [ ] All markers and routes should disappear
- [ ] Route info panel should hide

---

## ✅ **8. RESPONSIVE DESIGN TESTS**

### Desktop (>768px):

- [ ] Sidebar stays visible
- [ ] All controls accessible
- [ ] Proper layout maintained

### Mobile/Tablet (<768px):

- [ ] Resize browser window to mobile size
- [ ] Sidebar should hide automatically
- [ ] Hamburger menu should show/hide sidebar
- [ ] Touch interactions work on map

---

## ✅ **9. ERROR HANDLING TESTS**

### Network Issues:

- [ ] Disconnect internet briefly
- [ ] Try to create route
- [ ] Error message should appear
- [ ] Reconnect - functionality should restore

### Invalid Addresses:

- [ ] Enter nonsense text in search fields
- [ ] Should handle gracefully without crashing

---

## ✅ **10. PERFORMANCE TESTS**

### Loading Speed:

- [ ] Page loads within 3 seconds
- [ ] Map tiles load smoothly
- [ ] Route calculations complete within 5 seconds

### Memory Usage:

- [ ] Create multiple routes
- [ ] Clear routes
- [ ] No significant memory leaks (check dev tools)

---

## ✅ **11. INTEGRATION TESTS**

### API Connectivity:

- [ ] Routes use local OSRM backend (check Network tab in dev tools)
- [ ] Requests go to localhost:3001 or localhost:5001
- [ ] No external API calls for routing

### Enhanced Features:

- [ ] Fuel cost calculations work
- [ ] Carbon footprint shows realistic values
- [ ] Turn-by-turn instructions are detailed
- [ ] Multiple transportation modes produce different results

---

## 🎯 **EXPECTED RESULTS**

If all tests pass, you should have:

- ✅ Fully functional Google Maps-like interface
- ✅ Real-time routing with Berlin data
- ✅ Multiple transportation modes
- ✅ Enhanced analytics (fuel, CO₂, etc.)
- ✅ Turn-by-turn navigation
- ✅ Responsive design
- ✅ Self-hosted with no external dependencies

---

## 🐛 **TROUBLESHOOTING**

If something doesn't work:

1. **Check browser console** (F12) for errors
2. **Verify services are running**: `docker compose ps`
3. **Test API directly**: http://localhost:3001/health
4. **Check OSRM backend**: http://localhost:5001/route/v1/driving/13.388860,52.517037;13.397634,52.529407
5. **Restart services**: `docker compose restart`

---

## 📊 **REPORT YOUR RESULTS**

Please test each section and report:

- ✅ **Working perfectly**
- ⚠️ **Working with minor issues**
- ❌ **Not working** (with error details)

This will help identify any issues that need fixing!
