#!/bin/bash

# OSRM Complete Setup Script
# This script sets up a complete OSRM instance with enhanced features

set -e

# Configuration
REGION=${1:-"berlin"}
PROFILE=${2:-"car"}
DOWNLOAD_URL=""
MAP_FILE=""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}"
    exit 1
}

# Function to set download URL based on region
set_download_url() {
    case $REGION in
    "berlin")
        DOWNLOAD_URL="http://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf"
        MAP_FILE="berlin-latest.osm.pbf"
        ;;
    "germany")
        DOWNLOAD_URL="http://download.geofabrik.de/europe/germany-latest.osm.pbf"
        MAP_FILE="germany-latest.osm.pbf"
        ;;
    "usa")
        DOWNLOAD_URL="http://download.geofabrik.de/north-america/us-latest.osm.pbf"
        MAP_FILE="us-latest.osm.pbf"
        ;;
    "california")
        DOWNLOAD_URL="http://download.geofabrik.de/north-america/us/california-latest.osm.pbf"
        MAP_FILE="california-latest.osm.pbf"
        ;;
    "france")
        DOWNLOAD_URL="http://download.geofabrik.de/europe/france-latest.osm.pbf"
        MAP_FILE="france-latest.osm.pbf"
        ;;
    "uk")
        DOWNLOAD_URL="http://download.geofabrik.de/europe/great-britain-latest.osm.pbf"
        MAP_FILE="great-britain-latest.osm.pbf"
        ;;
    *)
        error "Unsupported region: $REGION. Supported regions: berlin, germany, usa, california, france, uk"
        ;;
    esac
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    if ! command -v docker &>/dev/null; then
        error "Docker is not installed. Please install Docker first."
    fi

    # Check for Docker Compose (both v1 and v2 syntax)
    if command -v docker-compose &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    elif docker compose version &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker compose"
    else
        error "Docker Compose is not installed. Please install Docker Compose first."
    fi

    log "Using Docker Compose command: $DOCKER_COMPOSE_CMD"

    # Check available disk space (need at least 10GB)
    available_space=$(df . | tail -1 | awk '{print $4}')
    if [ "$available_space" -lt 10485760 ]; then # 10GB in KB
        warn "Less than 10GB of disk space available. Large regions may fail to process."
    fi

    # Check available memory
    if command -v free &>/dev/null; then
        available_memory=$(free -m | awk 'NR==2{printf "%.0f", $7}' 2>/dev/null || echo "0")
    elif command -v vm_stat &>/dev/null; then
        # macOS memory check
        available_memory=$(vm_stat | grep "Pages free" | awk '{print int($3) * 4096 / 1024 / 1024}' 2>/dev/null || echo "0")
    else
        available_memory="0"
    fi

    if [ "$available_memory" -lt 4096 ]; then # 4GB
        warn "Less than 4GB of available memory. Processing may be slow or fail for large regions."
    fi

    log "Prerequisites check completed."
}

# Create directory structure
create_directories() {
    log "Creating directory structure..."

    mkdir -p data
    mkdir -p profiles
    mkdir -p nginx/logs
    mkdir -p ssl
    mkdir -p monitoring/grafana/{dashboards,datasources}
    mkdir -p api

    log "Directory structure created."
}

# Generate self-signed SSL certificates
generate_ssl_certificates() {
    log "Generating SSL certificates..."

    if [ ! -f ssl/cert.pem ] || [ ! -f ssl/key.pem ]; then
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout ssl/key.pem \
            -out ssl/cert.pem \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"
        log "SSL certificates generated."
    else
        log "SSL certificates already exist."
    fi
}

# Download map data
download_map_data() {
    log "Downloading map data for region: $REGION"

    if [ ! -f "data/$MAP_FILE" ]; then
        log "Downloading $MAP_FILE..."
        if command -v curl &>/dev/null; then
            curl -L -o "data/$MAP_FILE" "$DOWNLOAD_URL"
        elif command -v wget &>/dev/null; then
            wget -O "data/$MAP_FILE" "$DOWNLOAD_URL"
        else
            error "Neither curl nor wget is available. Please install one of them."
        fi
        log "Map data downloaded successfully."
    else
        log "Map data already exists. Skipping download."
    fi
}

# Process map data
process_map_data() {
    log "Processing map data with OSRM..."

    local base_name=$(basename "$MAP_FILE" .osm.pbf)
    local profile_path="/opt/car.lua"

    if [ "$PROFILE" = "custom" ]; then
        profile_path="/profiles/custom-car.lua"
    fi

    # Extract
    if [ ! -f "data/${base_name}.osrm" ]; then
        log "Extracting road network data..."
        docker run -t -v "${PWD}/data:/data" -v "${PWD}/profiles:/profiles" \
            ghcr.io/project-osrm/osrm-backend \
            osrm-extract -p $profile_path /data/$MAP_FILE
        log "Extraction completed."
    else
        log "Extracted data already exists. Skipping extraction."
    fi

    # Partition (for MLD algorithm)
    if [ ! -f "data/${base_name}.osrm.partition" ]; then
        log "Partitioning data for MLD algorithm..."
        docker run -t -v "${PWD}/data:/data" \
            ghcr.io/project-osrm/osrm-backend \
            osrm-partition /data/"${base_name}".osrm
        log "Partitioning completed."
    else
        log "Partitioned data already exists. Skipping partitioning."
    fi

    # Customize
    if [ ! -f "data/${base_name}.osrm.customize" ]; then
        log "Customizing data..."
        docker run -t -v "${PWD}/data:/data" \
            ghcr.io/project-osrm/osrm-backend \
            osrm-customize /data/"${base_name}".osrm
        log "Customization completed."
    else
        log "Customized data already exists. Skipping customization."
    fi

    # Create symlink for region.osrm
    # ln -sf "${base_name}.osrm" "data/region.osrm"
    # ln -sf "${base_name}.osrm.hsgr" "data/region.osrm.hsgr" 2>/dev/null || true
    # ln -sf "${base_name}.osrm.partition" "data/region.osrm.partition" 2>/dev/null || true
    # ln -sf "${base_name}.osrm.customize" "data/region.osrm.customize" 2>/dev/null || true

    log "Map data processing completed."
}

# Start services
start_services() {
    log "Starting OSRM services..."

    # Pull latest images
    log "Pulling Docker images..."
    $DOCKER_COMPOSE_CMD pull

    # Build custom API service
    log "Building custom API service..."
    $DOCKER_COMPOSE_CMD build osrm-api

    # Start services
    log "Starting all services..."
    $DOCKER_COMPOSE_CMD up -d

    log "Services started. Waiting for health checks..."

    # Wait for services to be healthy
    sleep 30

    # Check service health
    check_service_health
}

# Check service health
check_service_health() {
    log "Checking service health..."

    local services=("osrm-backend-1" "osrm-backend-2" "osrm-api" "redis" "prometheus" "grafana")

    for service in "${services[@]}"; do
        if $DOCKER_COMPOSE_CMD ps "$service" | grep -q "Up"; then
            log "✓ $service is running"
        else
            warn "✗ $service is not running properly"
        fi
    done

    # Test OSRM API
    log "Testing OSRM API..."
    sleep 10

    if curl -s "http://localhost:5001/api/route/v1/driving/13.388860,52.517037;13.397634,52.529407?overview=false" >/dev/null; then
        log "✓ OSRM API is responding"
    else
        warn "✗ OSRM API is not responding"
    fi

    # Test enhanced API
    if curl -s "http://localhost:3001/health" >/dev/null; then
        log "✓ Enhanced API is responding"
    else
        warn "✗ Enhanced API is not responding"
    fi
}

# Display service URLs
display_service_urls() {
    log "OSRM setup completed successfully!"
    echo ""
    echo -e "${BLUE}Service URLs:${NC}"
    echo -e "  Frontend:           ${GREEN}http://localhost:9966${NC}"
    echo -e "  OSRM API:           ${GREEN}http://localhost:5001${NC}"
    echo -e "  Enhanced API:       ${GREEN}http://localhost:3001${NC}"
    echo -e "  Grafana:            ${GREEN}http://localhost:3000${NC} (admin/admin123)"
    echo -e "  Prometheus:         ${GREEN}http://localhost:9090${NC}"
    echo -e "  Redis:              ${GREEN}localhost:6379${NC}"
    echo ""
    echo -e "${BLUE}API Examples:${NC}"
    echo -e "  Route:              ${GREEN}curl 'http://localhost:5001/api/route/v1/driving/13.388860,52.517037;13.397634,52.529407'${NC}"
    echo -e "  Enhanced Route:     ${GREEN}curl 'http://localhost:3001/route?waypoints=[{\"lng\":13.388860,\"lat\":52.517037},{\"lng\":13.397634,\"lat\":52.529407}]'${NC}"
    echo -e "  Nearest:            ${GREEN}curl 'http://localhost:3001/nearest?lat=52.517037&lng=13.388860'${NC}"
    echo ""
    echo -e "${YELLOW}To stop services: $DOCKER_COMPOSE_CMD down${NC}"
    echo -e "${YELLOW}To view logs: $DOCKER_COMPOSE_CMD logs -f${NC}"
}

# Main execution
main() {
    log "Starting OSRM Complete Setup for region: $REGION with profile: $PROFILE"

    set_download_url
    check_prerequisites
    create_directories
    generate_ssl_certificates
    download_map_data
    process_map_data
    start_services
    display_service_urls
}

# Help function
show_help() {
    echo "OSRM Complete Setup Script"
    echo ""
    echo "Usage: $0 [REGION] [PROFILE]"
    echo ""
    echo "REGION options:"
    echo "  berlin      - Berlin, Germany (default, ~200MB)"
    echo "  germany     - Germany (~3.5GB)"
    echo "  usa         - United States (~9GB)"
    echo "  california  - California, USA (~1GB)"
    echo "  france      - France (~3.5GB)"
    echo "  uk          - United Kingdom (~2GB)"
    echo ""
    echo "PROFILE options:"
    echo "  car         - Standard car profile (default)"
    echo "  custom      - Custom enhanced car profile"
    echo ""
    echo "Examples:"
    echo "  $0                    # Setup Berlin with car profile"
    echo "  $0 california custom  # Setup California with custom profile"
    echo "  $0 germany car        # Setup Germany with car profile"
}

# Check for help flag
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# Run main function
main
