# OSRM Enterprise - Region Setup Guide

## 🌍 Adding India Data or World Data to Your OSRM Enterprise Project

This guide explains how to set up your OSRM Enterprise stack with different geographic regions including India, Asia, or complete world data.

## 📋 Quick Setup Commands

### For India Data

```bash
# Setup with India data (~1.5GB)
./setup.sh india car

# System requirements: 8GB RAM, 15GB disk space
# Processing time: 30-60 minutes
```

### For Complete World Data

```bash
# Setup with world data (~70GB)
./setup.sh world car

# System requirements: 32GB RAM, 200GB disk space
# Processing time: 4-8 hours
```

### For Asia Data

```bash
# Setup with Asia data (~14GB)
./setup.sh asia car

# System requirements: 16GB RAM, 50GB disk space
# Processing time: 2-4 hours
```

## 🗺️ Available Regions

| Region         | File Size | RAM Required | Disk Space | Processing Time | Description               |
| -------------- | --------- | ------------ | ---------- | --------------- | ------------------------- |
| **berlin**     | ~200MB    | 4GB          | 5GB        | 5-10 min        | Berlin, Germany (default) |
| **germany**    | ~3.5GB    | 8GB          | 20GB       | 1-2 hours       | Complete Germany          |
| **usa**        | ~11GB     | 16GB         | 40GB       | 2-4 hours       | United States             |
| **california** | ~1.2GB    | 8GB          | 15GB       | 30-60 min       | California, USA           |
| **france**     | ~3.8GB    | 8GB          | 20GB       | 1-2 hours       | France                    |
| **uk**         | ~1.1GB    | 8GB          | 15GB       | 30-60 min       | United Kingdom            |
| **india**      | ~1.5GB    | 8GB          | 15GB       | 30-60 min       | India                     |
| **asia**       | ~14GB     | 16GB         | 50GB       | 2-4 hours       | All of Asia               |
| **world**      | ~70GB     | 32GB         | 200GB      | 4-8 hours       | Entire World              |

## 🔧 Frontend Configuration

The frontend automatically adapts to different regions through the `demo/config.js` file.

### Switching to India Configuration

1. **Edit the configuration file:**

```javascript
// In demo/config.js, change:
REGION: 'india',  // Change from 'berlin' to 'india'
```

2. **Restart the frontend:**

```bash
cd demo
python3 -m http.server 9966
```

### Configuration Options

The `config.js` file includes pre-configured settings for:

- **Berlin**: Restricted to Berlin bounds with validation
- **India**: Covers entire India with appropriate zoom levels
- **Asia**: Covers all Asian countries
- **World**: Global coverage with no restrictions

## 🚀 Step-by-Step Setup Process

### 1. Choose Your Region

Run the interactive setup:

```bash
./setup.sh
```

Or directly specify a region:

```bash
./setup.sh [region] [profile]
# Example: ./setup.sh india car
```

### 2. Monitor the Setup Process

The setup script will:

1. Download the OSM data file
2. Extract and prepare the data
3. Build routing graphs
4. Start Docker services
5. Configure the API endpoints

### 3. Verify the Setup

Test the services:

```bash
./test-services.sh
```

Expected output:

```
✅ OSRM API is healthy
✅ Frontend is accessible
✅ All services are running correctly
```

### 4. Configure Frontend (if needed)

For non-Berlin regions, update the frontend configuration:

```javascript
// demo/config.js
const OSRM_CONFIG = {
  REGION: "india", // or 'asia', 'world'
  // ... rest of configuration
};
```

## 🌏 Region-Specific Details

### India Setup

- **Coverage**: Complete India including all states and territories
- **Coordinates**: Latitude 6.46°N to 35.50°N, Longitude 68.11°E to 97.42°E
- **Major Cities**: Mumbai, Delhi, Bangalore, Chennai, Kolkata, Hyderabad
- **Use Cases**: Logistics, delivery, transportation planning across India

### Asia Setup

- **Coverage**: All Asian countries
- **Includes**: India, China, Japan, Korea, Thailand, Vietnam, Malaysia, Singapore, Indonesia, Philippines, and more
- **Use Cases**: Regional logistics, cross-border routing, continental transportation

### World Setup

- **Coverage**: Complete global routing
- **Use Cases**: International logistics, global transportation planning
- **Note**: Requires significant computational resources

## 🔍 Testing Your Setup

### 1. Test API Directly

For India (Mumbai to Delhi):

```bash
curl -X POST http://localhost:3003/api/v2/route/advanced \
  -H "Content-Type: application/json" \
  -d '{
    "coordinates": [[72.8777, 19.0760], [77.1025, 28.7041]],
    "profile": "car",
    "alternatives": false,
    "steps": true,
    "geometries": "geojson",
    "overview": "full"
  }'
```

### 2. Test Frontend

1. Open http://localhost:9966
2. Click on the map to set start and end points
3. Click "Find Route"
4. Verify the route is calculated successfully

## 🛠️ Troubleshooting

### Common Issues

1. **Out of Memory Errors**

   - Increase Docker memory allocation
   - Use smaller regions for testing
   - Consider using a machine with more RAM

2. **Disk Space Issues**

   - Ensure sufficient free space before starting
   - Clean up old Docker images: `docker system prune`

3. **Long Processing Times**

   - This is normal for large datasets
   - Monitor progress with `docker logs osrm-backend`

4. **Frontend Not Loading Correctly**
   - Check if `config.js` is properly configured
   - Verify the region setting matches your data
   - Hard refresh the browser (Ctrl+F5)

### Performance Optimization

For large datasets:

1. **Increase Docker Resources:**

```bash
# In docker-compose.yml, increase memory limits:
services:
  osrm-backend:
    mem_limit: 16g  # Increase for larger datasets
```

2. **Use SSD Storage:**

   - Store data on SSD for faster processing
   - Use NVMe drives for best performance

3. **Optimize for Your Use Case:**
   - Use `car` profile for general routing
   - Use `bicycle` or `foot` for specific use cases

## 📊 Data Sources

All data comes from OpenStreetMap via Geofabrik:

- **India**: https://download.geofabrik.de/asia/india-latest.osm.pbf
- **Asia**: https://download.geofabrik.de/asia-latest.osm.pbf
- **World**: https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf

## 🔄 Updating Data

To update to the latest data:

1. **Stop services:**

```bash
docker compose down
```

2. **Remove old data:**

```bash
rm -rf data/
```

3. **Re-run setup:**

```bash
./setup.sh [region] [profile]
```

## 📞 Support

If you encounter issues:

1. Check the logs: `docker compose logs`
2. Verify system requirements are met
3. Ensure sufficient disk space and memory
4. Try with a smaller region first (e.g., `berlin`)

## 🎯 Next Steps

After successful setup:

1. **Customize the frontend** for your specific use case
2. **Integrate with your applications** using the API
3. **Set up monitoring** for production deployments
4. **Configure SSL/TLS** for secure connections
5. **Implement caching** for better performance

---

**Note**: The setup process downloads large files and requires significant computational resources. Plan accordingly and ensure stable internet connection during setup.
