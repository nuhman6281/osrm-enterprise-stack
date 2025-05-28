# OSRM Complete Self-Hosting Package

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue.svg)](https://docs.docker.com/compose/)
[![OSRM](https://img.shields.io/badge/OSRM-v6.0.0-green.svg)](https://project-osrm.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen.svg)](https://nodejs.org/)

A comprehensive, production-ready OSRM (Open Source Routing Machine) self-hosting solution with enhanced features, comprehensive API documentation, monitoring, caching, and load balancing.

## 🚀 Features

### Core OSRM Services

- **Route Service** - Fast route calculation with turn-by-turn navigation
- **Table Service** - Distance/duration matrices for fleet optimization
- **Match Service** - GPS trace matching to road networks
- **Trip Service** - Traveling Salesman Problem solver
- **Nearest Service** - Snap coordinates to road network
- **Tile Service** - Vector tiles for route visualization

### Enhanced Features

- **🔄 Load Balancing** - Multiple OSRM backend instances with automatic failover
- **⚡ Redis Caching** - Intelligent caching for improved performance
- **📚 API Documentation** - Interactive Swagger-style documentation
- **🔒 SSL/TLS Support** - Secure HTTPS connections
- **🛡️ Rate Limiting** - Protection against API abuse
- **📊 Monitoring** - Prometheus + Grafana dashboards
- **🏥 Health Checks** - Automatic service monitoring
- **🎯 Custom Profiles** - Enhanced routing profiles for different use cases
- **🗺️ Isochrone Analysis** - Reachability studies and time-based zones
- **🚛 Fleet Management** - Vehicle optimization and route planning

## 📋 Prerequisites

- **Docker** (20.10+)
- **Docker Compose** (2.0+) - Available as `docker-compose` or `docker compose`
- **Minimum 4GB RAM** (8GB+ recommended for large regions)
- **10GB+ free disk space**
- **macOS/Linux** (Windows with WSL2)

## 🛠️ Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone https://github.com/nuhman6281/osrm-complete-package.git
cd osrm-complete-package

# Make setup script executable
chmod +x setup.sh quick-start.sh

# Quick demo setup (Berlin, Germany - ~200MB)
./quick-start.sh

# Or run full setup with custom region
./setup.sh california custom
```

### 2. Available Regions

| Region       | Size   | Description               | Command                 |
| ------------ | ------ | ------------------------- | ----------------------- |
| `berlin`     | ~200MB | Berlin, Germany (default) | `./setup.sh berlin car` |
| `california` | ~1GB   | California, USA           | `./setup.sh california` |
| `germany`    | ~3.5GB | Germany                   | `./setup.sh germany`    |
| `france`     | ~3.5GB | France                    | `./setup.sh france`     |
| `uk`         | ~2GB   | United Kingdom            | `./setup.sh uk`         |
| `usa`        | ~9GB   | United States             | `./setup.sh usa`        |

### 3. Service Access

After setup completes, access services at:

- **🌐 Interactive Frontend**: http://localhost:9966
- **🔧 OSRM API**: http://localhost:5001
- **⚡ Enhanced API**: http://localhost:3001
- **📚 API Documentation**: http://localhost:3001/api-docs
- **📊 Grafana**: http://localhost:3000 (admin/admin123)
- **📈 Prometheus**: http://localhost:9090

## 📚 API Documentation

### Interactive Documentation

Visit **http://localhost:3001/api-docs** in your browser for:

- **Interactive API Explorer** - Test endpoints directly from the browser
- **Complete Parameter Documentation** - Detailed descriptions and examples
- **Response Schema Documentation** - Clear response format specifications
- **Copy-Paste Examples** - Ready-to-use curl commands

### Quick API Reference

Visit **http://localhost:3001/api** for a concise endpoint overview.

### Standard OSRM API

All standard OSRM endpoints are available with the `/api/` prefix:

```bash
# Route calculation
curl 'http://localhost:5001/api/route/v1/driving/13.388860,52.517037;13.397634,52.529407'

# Distance matrix
curl 'http://localhost:5001/api/table/v1/driving/13.388860,52.517037;13.397634,52.529407;13.428555,52.523219'

# Nearest road
curl 'http://localhost:5001/api/nearest/v1/driving/13.388860,52.517037'
```

### Enhanced API Endpoints

#### Route with Caching

```bash
curl 'http://localhost:3001/route?waypoints=[{"lng":13.388860,"lat":52.517037},{"lng":13.397634,"lat":52.529407}]'
```

#### Distance Matrix

```bash
curl -X POST http://localhost:3001/matrix \
  -H "Content-Type: application/json" \
  -d '{
    "sources": [{"lng":13.388860,"lat":52.517037}],
    "destinations": [{"lng":13.397634,"lat":52.529407},{"lng":13.428555,"lat":52.523219}]
  }'
```

#### Trip Optimization (TSP Solver)

```bash
curl -X POST http://localhost:3001/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "waypoints": [
      {"lng":13.388860,"lat":52.517037},
      {"lng":13.397634,"lat":52.529407},
      {"lng":13.428555,"lat":52.523219}
    ]
  }'
```

#### GPS Trace Matching

```bash
curl -X POST http://localhost:3001/match \
  -H "Content-Type: application/json" \
  -d '{
    "coordinates": [
      {"lng":13.388860,"lat":52.517037},
      {"lng":13.397634,"lat":52.529407}
    ],
    "timestamps": [1234567890, 1234567920]
  }'
```

#### Isochrone Analysis

```bash
curl -X POST http://localhost:3001/isochrone \
  -H "Content-Type: application/json" \
  -d '{
    "center": {"lng":13.388860,"lat":52.517037},
    "time_limits": [300, 600, 900]
  }'
```

#### Nearest Roads

```bash
curl 'http://localhost:3001/nearest?lat=52.517037&lng=13.388860&number=3'
```

## 🏗️ Project Structure

```
osrm-complete-package/
├── 📁 api/                     # Enhanced API service
│   ├── server.js              # Main API server with documentation
│   ├── swagger.js             # API documentation configuration
│   ├── package.json           # Node.js dependencies
│   ├── Dockerfile             # API service container
│   └── healthcheck.js         # Health check script
├── 📁 client/                 # JavaScript client library
│   └── osrm-client.js         # Comprehensive OSRM client
├── 📁 demo/                   # Interactive demo
│   └── index.html             # Web-based demo interface
├── 📁 nginx/                  # Load balancer and proxy
│   ├── nginx.conf             # Main proxy configuration
│   └── nginx-lb.conf          # Load balancer configuration
├── 📁 profiles/               # Custom routing profiles
│   └── custom-car.lua         # Enhanced car routing profile
├── 📁 monitoring/             # Monitoring configuration
│   ├── prometheus.yml         # Metrics collection config
│   └── grafana/               # Dashboard configurations
├── 📁 ssl/                    # SSL certificates
├── 📁 data/                   # Map data storage
├── docker-compose.yml         # Service orchestration
├── setup.sh                   # Main setup script
├── quick-start.sh             # Quick demo setup
├── README.md                  # This documentation
└── PROJECT_SUMMARY.md         # Detailed project overview
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file to customize settings:

```env
# OSRM Backend
OSRM_BACKEND_URL=http://nginx-lb:80

# Redis Configuration
REDIS_URL=redis://redis:6379

# API Settings
NODE_ENV=production
PORT=3001

# Grafana Security
GF_SECURITY_ADMIN_PASSWORD=your_secure_password

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Custom Profiles

Edit `profiles/custom-car.lua` to customize routing behavior:

```lua
-- Speed profiles in km/h
speed_profile = {
  ["motorway"]        = 90,
  ["trunk"]           = 85,
  ["primary"]         = 65,
  ["secondary"]       = 55,
  ["tertiary"]        = 40,
  ["residential"]     = 25,
  ["service"]         = 15
}

-- Surface penalties
surface_penalties = {
  ["paved"]           = 1.0,
  ["unpaved"]         = 1.5,
  ["gravel"]          = 2.0,
  ["dirt"]            = 3.0
}
```

### Nginx Configuration

Modify `nginx/nginx.conf` for:

- **Rate limiting adjustments**
- **SSL certificate paths**
- **Custom routing rules**
- **CORS settings**
- **Security headers**

## 📊 Monitoring & Analytics

### Grafana Dashboards

Access Grafana at **http://localhost:3000** with:

- **Username**: `admin`
- **Password**: `admin123`

Pre-configured dashboards include:

- **OSRM API Performance** - Response times, throughput, error rates
- **System Resource Usage** - CPU, memory, disk utilization
- **Redis Cache Statistics** - Hit rates, memory usage, key counts
- **Request Rate Monitoring** - Traffic patterns and peak usage
- **Geographic Analytics** - Request distribution by region

### Prometheus Metrics

Available at **http://localhost:9090** with metrics for:

- **API Performance**: Response times, request rates, error rates
- **System Resources**: CPU, memory, disk, network usage
- **Cache Performance**: Redis hit rates, memory usage
- **Load Balancer**: Backend health, request distribution
- **Custom Metrics**: Route complexity, optimization efficiency

## 🔄 Management Commands

### Service Management

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# Restart specific service
docker compose restart osrm-api

# View service status
docker compose ps

# Scale backend instances
docker compose up -d --scale osrm-backend-1=3
```

### Monitoring & Logs

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f osrm-backend-1

# Monitor resource usage
docker stats

# Check service health
curl http://localhost:3001/health
```

### Data Management

```bash
# Update map data for different region
./setup.sh france custom

# Clear cache
curl -X DELETE http://localhost:3001/cache

# Check cache statistics
curl http://localhost:3001/cache/stats

# Backup data directory
tar -czf osrm-data-backup.tar.gz data/
```

## 🛡️ Security

### SSL/TLS Configuration

The setup includes self-signed certificates. For production:

1. **Replace certificates** in `ssl/` directory
2. **Update nginx configuration** with proper certificate paths
3. **Configure proper domain names**
4. **Use Let's Encrypt** for automatic certificate management

### Rate Limiting

Default limits (configurable in `nginx/nginx.conf`):

- **API endpoints**: 10 requests/second
- **Frontend**: 5 requests/second
- **Burst allowance**: 20 requests
- **Window**: 15 minutes

### Access Control

Configure IP restrictions in `nginx/nginx.conf`:

```nginx
location /admin {
    allow 192.168.1.0/24;
    allow 10.0.0.0/8;
    deny all;
}
```

### Security Headers

Automatically configured:

- **HSTS** (HTTP Strict Transport Security)
- **CSP** (Content Security Policy)
- **X-Frame-Options**
- **X-Content-Type-Options**
- **Referrer-Policy**

## 🚀 Performance Optimization

### Memory Requirements

| Region     | Minimum RAM | Recommended RAM | Processing Time |
| ---------- | ----------- | --------------- | --------------- |
| Berlin     | 2GB         | 4GB             | 2-5 minutes     |
| California | 4GB         | 8GB             | 10-15 minutes   |
| Germany    | 8GB         | 16GB            | 30-45 minutes   |
| France     | 8GB         | 16GB            | 30-45 minutes   |
| UK         | 6GB         | 12GB            | 20-30 minutes   |
| USA        | 32GB        | 64GB            | 2-4 hours       |

### Caching Strategy

- **Redis Primary Cache**: API responses, route calculations
- **Memory Cache Fallback**: When Redis is unavailable
- **TTL Settings**: Configurable per endpoint type
- **Cache Invalidation**: Automatic and manual options

### Load Balancing

- **Algorithm**: Least connections with health checks
- **Health Checks**: Automatic failover and recovery
- **Retry Logic**: 2 attempts with 30s timeout
- **Session Persistence**: Stateless design for scalability

## 🐛 Troubleshooting

### Common Issues

#### Services Not Starting

```bash
# Check system resources
docker stats
free -h  # Linux
vm_stat  # macOS

# Check logs for errors
docker compose logs

# Restart problematic services
docker compose restart osrm-backend-1
```

#### API Not Responding

```bash
# Test backend health directly
curl http://localhost:5001/api/route/v1/driving/13.388860,52.517037;13.397634,52.529407

# Check load balancer status
docker compose logs nginx-lb

# Verify network connectivity
docker compose exec osrm-api ping osrm-backend-1
```

#### Memory Issues

```bash
# Check memory usage
docker stats --no-stream

# Reduce backend instances
docker compose up -d --scale osrm-backend-2=0

# Use smaller region for testing
./setup.sh berlin car
```

#### Cache Issues

```bash
# Check Redis connectivity
docker compose exec osrm-api redis-cli -h redis ping

# Clear cache
curl -X DELETE http://localhost:3001/cache

# Check cache statistics
curl http://localhost:3001/cache/stats
```

### Log Locations

- **Nginx Access/Error**: `nginx/logs/`
- **API Logs**: `docker compose logs osrm-api`
- **OSRM Backend**: `docker compose logs osrm-backend-1`
- **Redis Logs**: `docker compose logs redis`
- **System Logs**: `docker compose logs`

### Performance Tuning

```bash
# Increase backend instances
docker compose up -d --scale osrm-backend-1=4

# Adjust memory limits in docker-compose.yml
deploy:
  resources:
    limits:
      memory: 16G
    reservations:
      memory: 8G

# Optimize Redis configuration
redis-cli CONFIG SET maxmemory 1gb
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

## 📈 Scaling

### Horizontal Scaling

```bash
# Scale OSRM backends
docker compose up -d --scale osrm-backend-1=5 --scale osrm-backend-2=5

# Add more API instances
docker compose up -d --scale osrm-api=3

# Load balance across multiple machines
# Update nginx upstream configuration
```

### Vertical Scaling

```bash
# Increase container resources
# Edit docker-compose.yml:
deploy:
  resources:
    limits:
      memory: 32G
      cpus: '8'
```

### Multi-Region Deployment

```bash
# Deploy multiple regions
./setup.sh germany car
./setup.sh france car
./setup.sh uk car

# Configure region-specific routing
# Update nginx configuration for geographic routing
```

## 🤝 Contributing

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/amazing-feature`
3. **Make changes and test thoroughly**
4. **Commit changes**: `git commit -m 'Add amazing feature'`
5. **Push to branch**: `git push origin feature/amazing-feature`
6. **Submit pull request**

### Development Setup

```bash
# Clone for development
git clone https://github.com/nuhman6281/osrm-complete-package.git
cd osrm-complete-package

# Install development dependencies
cd api && npm install
cd ../client && npm install

# Run tests
npm test

# Start development environment
./setup.sh berlin car
```

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **[OSRM Project](https://project-osrm.org/)** - The core routing engine
- **[OpenStreetMap](https://www.openstreetmap.org/)** - Community-driven map data
- **[Geofabrik](https://www.geofabrik.de/)** - OSM data extracts and processing
- **[Docker](https://www.docker.com/)** - Containerization platform
- **[Nginx](https://nginx.org/)** - High-performance web server and load balancer
- **[Redis](https://redis.io/)** - In-memory data structure store
- **[Prometheus](https://prometheus.io/)** - Monitoring and alerting toolkit
- **[Grafana](https://grafana.com/)** - Analytics and monitoring platform

## 📞 Support

For issues, questions, and contributions:

1. **📖 Check Documentation**: Review this README and API docs
2. **🔍 Search Issues**: Look for existing solutions
3. **🐛 Report Bugs**: Open detailed issue reports
4. **💡 Feature Requests**: Suggest improvements
5. **📧 Contact**: Reach out via GitHub issues

## 🗺️ Roadmap

### Upcoming Features

- **🌍 Multi-language support** for API documentation
- **🔄 Real-time traffic integration** with external data sources
- **🚁 Drone routing profiles** for aerial navigation
- **🚲 Bicycle and pedestrian optimization** with elevation data
- **📱 Mobile SDK** for iOS and Android
- **☁️ Cloud deployment templates** for AWS, GCP, Azure
- **🔌 Plugin system** for custom routing algorithms
- **📊 Advanced analytics dashboard** with business intelligence

---

**Happy Routing! 🗺️✨**

_Built with ❤️ for the open-source community_
