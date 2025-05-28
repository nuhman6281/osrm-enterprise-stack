# OSRM Enterprise Deployment Guide

This guide covers deploying OSRM Enterprise in production environments with high availability, security, and performance optimizations.

## 🚀 Quick Production Deployment

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- 8GB+ RAM (16GB+ recommended)
- 50GB+ storage for map data
- SSL certificates (for production)

### 1. Clone and Setup

```bash
git clone <your-repo>
cd osrm-enterprise
chmod +x *.sh
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### 3. Generate SSL Certificates

```bash
# For development (self-signed)
./ssl/generate-certs.sh

# For production, use Let's Encrypt or your CA certificates
# Place them in ssl/server.crt and ssl/server.key
```

### 4. Deploy Services

```bash
# Quick start with Berlin data
./quick-start.sh

# Or custom region
./setup.sh
```

### 5. Verify Deployment

```bash
./test-services.sh
```

## 🏗️ Production Architecture

### High Availability Setup

```yaml
# docker-compose.prod.yml
version: "3.8"

services:
  # Multiple OSRM backends across different nodes
  osrm-backend-1:
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.labels.tier == backend
      resources:
        limits:
          memory: 4G
          cpus: "2"

  # Load balancer with health checks
  nginx-lb:
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.labels.tier == proxy
```

### Scaling Configuration

```bash
# Scale OSRM backends
docker-compose up -d --scale osrm-backend-1=3 --scale osrm-backend-2=3

# Scale API services
docker-compose up -d --scale osrm-api=2
```

## 🔧 Configuration

### Environment Variables

```bash
# .env file
NODE_ENV=production
LOG_LEVEL=info
REDIS_MAX_MEMORY=2gb
OSRM_ALGORITHM=mld
RATE_LIMIT_REQUESTS=1000
RATE_LIMIT_WINDOW=3600
SSL_ENABLED=true
MONITORING_ENABLED=true
```

### Nginx Configuration

```nginx
# nginx/nginx.prod.conf
upstream osrm_api {
    least_conn;
    server osrm-api-1:3000 max_fails=3 fail_timeout=30s;
    server osrm-api-2:3000 max_fails=3 fail_timeout=30s;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;
    ssl_dhparam /etc/nginx/ssl/dhparam.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    location /api/ {
        proxy_pass http://osrm_api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Caching
        proxy_cache osrm_cache;
        proxy_cache_valid 200 5m;
        proxy_cache_key "$scheme$request_method$host$request_uri";
    }
}
```

### Redis Configuration

```redis
# redis/redis.prod.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
```

## 📊 Monitoring & Alerting

### Prometheus Alerts

```yaml
# monitoring/alerts.yml
groups:
  - name: osrm
    rules:
      - alert: OSRMHighLatency
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "OSRM API high latency"

      - alert: OSRMBackendDown
        expr: up{job="osrm-backend"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "OSRM backend is down"
```

### Grafana Dashboards

Import the provided dashboard JSON files:

- `monitoring/grafana/dashboards/osrm-dashboard.json`
- `monitoring/grafana/dashboards/system-dashboard.json`

## 🔒 Security

### SSL/TLS Configuration

```bash
# Generate production certificates with Let's Encrypt
certbot certonly --standalone -d your-domain.com

# Copy certificates
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ssl/server.crt
cp /etc/letsencrypt/live/your-domain.com/privkey.pem ssl/server.key
```

### Firewall Rules

```bash
# UFW configuration
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw deny 5000:5002  # Block direct OSRM access
ufw deny 6379       # Block direct Redis access
ufw enable
```

### API Security

```javascript
// api/middleware/security.js
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP",
});

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);
```

## 🚀 Performance Optimization

### OSRM Backend Tuning

```bash
# Increase shared memory for better performance
echo 'kernel.shmmax = 68719476736' >> /etc/sysctl.conf
echo 'kernel.shmall = 4294967296' >> /etc/sysctl.conf
sysctl -p
```

### Database Optimization

```bash
# Optimize map data processing
osrm-extract -p profiles/custom-car.lua map.osm.pbf
osrm-partition map.osrm
osrm-customize map.osrm
```

### Caching Strategy

```javascript
// Multi-level caching
const cache = {
  // L1: In-memory cache (fastest)
  memory: new Map(),

  // L2: Redis cache (shared)
  redis: redisClient,

  // L3: CDN cache (global)
  cdn: cloudflareCache,
};
```

## 📈 Scaling

### Horizontal Scaling

```bash
# Add more OSRM backends
docker-compose up -d --scale osrm-backend-1=5

# Add more API instances
docker-compose up -d --scale osrm-api=3
```

### Vertical Scaling

```yaml
# Increase resources
services:
  osrm-backend-1:
    deploy:
      resources:
        limits:
          memory: 8G
          cpus: "4"
```

### Database Sharding

```javascript
// Geographic sharding
const getBackend = (lat, lng) => {
  if (lat > 50) return "europe-backend";
  if (lat < 30) return "africa-backend";
  return "default-backend";
};
```

## 🔄 Backup & Recovery

### Data Backup

```bash
#!/bin/bash
# backup.sh

# Backup Redis data
docker exec osrm-redis redis-cli BGSAVE
docker cp osrm-redis:/data/dump.rdb ./backups/redis-$(date +%Y%m%d).rdb

# Backup configuration
tar -czf backups/config-$(date +%Y%m%d).tar.gz nginx/ api/ monitoring/

# Backup to S3
aws s3 sync ./backups/ s3://your-backup-bucket/osrm/
```

### Disaster Recovery

```bash
#!/bin/bash
# restore.sh

# Restore Redis data
docker cp ./backups/redis-latest.rdb osrm-redis:/data/dump.rdb
docker restart osrm-redis

# Restore configuration
tar -xzf backups/config-latest.tar.gz

# Restart services
docker-compose restart
```

## 🔍 Troubleshooting

### Common Issues

1. **High Memory Usage**

   ```bash
   # Check memory usage
   docker stats

   # Optimize Redis
   docker exec osrm-redis redis-cli CONFIG SET maxmemory-policy allkeys-lru
   ```

2. **Slow Route Calculation**

   ```bash
   # Check OSRM backend logs
   docker logs osrm-backend-1

   # Verify map data integrity
   docker exec osrm-backend-1 osrm-routed --help
   ```

3. **SSL Certificate Issues**

   ```bash
   # Verify certificate
   openssl x509 -in ssl/server.crt -text -noout

   # Test SSL connection
   openssl s_client -connect localhost:443
   ```

### Log Analysis

```bash
# Centralized logging with ELK stack
docker run -d \
  --name elasticsearch \
  -p 9200:9200 \
  elasticsearch:7.14.0

# View aggregated logs
docker logs osrm-enterprise-api | grep ERROR
```

## 📋 Maintenance

### Regular Tasks

```bash
# Weekly maintenance script
#!/bin/bash

# Update map data
./update-maps.sh

# Clean old logs
find ./api/logs -name "*.log" -mtime +7 -delete

# Optimize Redis
docker exec osrm-redis redis-cli BGREWRITEAOF

# Update SSL certificates
certbot renew --quiet
```

### Health Checks

```bash
# Automated health monitoring
#!/bin/bash
# health-monitor.sh

while true; do
  if ! curl -f http://localhost:3003/health; then
    echo "API unhealthy, restarting..."
    docker-compose restart osrm-api
  fi
  sleep 60
done
```

## 🌐 Multi-Region Deployment

### Global Load Balancing

```yaml
# docker-compose.global.yml
version: "3.8"

services:
  # US East region
  osrm-us-east:
    image: osrm-enterprise:latest
    environment:
      - REGION=us-east
      - MAP_DATA=north-america-latest.osm.pbf

  # Europe region
  osrm-europe:
    image: osrm-enterprise:latest
    environment:
      - REGION=europe
      - MAP_DATA=europe-latest.osm.pbf
```

### CDN Integration

```javascript
// Geographic routing
const getClosestRegion = (clientIP) => {
  const geoData = geoip.lookup(clientIP);

  if (geoData.country === "US") return "us-east.osrm.example.com";
  if (geoData.continent === "EU") return "eu.osrm.example.com";
  return "global.osrm.example.com";
};
```

## 📞 Support

For production support:

- Check logs: `docker-compose logs [service]`
- Monitor metrics: http://localhost:3000 (Grafana)
- Run diagnostics: `./test-services.sh`
- Performance tuning: See optimization section above

## 🔗 Additional Resources

- [OSRM Documentation](http://project-osrm.org/)
- [Docker Best Practices](https://docs.docker.com/develop/best-practices/)
- [Nginx Performance Tuning](https://nginx.org/en/docs/)
- [Redis Optimization](https://redis.io/topics/memory-optimization)
