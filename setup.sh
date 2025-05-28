#!/bin/bash

# OSRM Enterprise Stack Setup Script
# Compatible with macOS and Linux

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
DOCKER_COMPOSE_CMD="docker-compose"
REGION=""
PROFILE=""
ALGORITHM="mld"
MEMORY_LIMIT="8G"

# Available regions (format: "region|url|description")
REGIONS=(
    "berlin|https://download.geofabrik.de/europe/germany/berlin-latest.osm.pbf|Berlin, Germany (~200MB)"
    "germany|https://download.geofabrik.de/europe/germany-latest.osm.pbf|Germany (~3.5GB)"
    "usa|https://download.geofabrik.de/north-america/us-latest.osm.pbf|United States (~11GB)"
    "california|https://download.geofabrik.de/north-america/us/california-latest.osm.pbf|California, USA (~1.2GB)"
    "france|https://download.geofabrik.de/europe/france-latest.osm.pbf|France (~3.8GB)"
    "uk|https://download.geofabrik.de/europe/great-britain-latest.osm.pbf|United Kingdom (~1.1GB)"
    "india|https://download.geofabrik.de/asia/india-latest.osm.pbf|India (~1.5GB)"
    "asia|https://download.geofabrik.de/asia-latest.osm.pbf|Asia (~14GB)"
    "world|https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf|Entire World (~70GB)"
)

# Available routing profiles (format: "profile|description")
PROFILES=(
    "car|Car routing with traffic rules and restrictions"
    "bicycle|Bicycle routing with bike lanes and paths"
    "foot|Pedestrian routing with walkways and paths"
    "custom|Custom routing profile (requires manual configuration)"
)

# Helper functions to get region/profile data
get_region_url() {
    local region="$1"
    for entry in "${REGIONS[@]}"; do
        local r=$(echo "$entry" | cut -d'|' -f1)
        if [ "$r" = "$region" ]; then
            echo "$entry" | cut -d'|' -f2
            return
        fi
    done
}

get_region_description() {
    local region="$1"
    for entry in "${REGIONS[@]}"; do
        local r=$(echo "$entry" | cut -d'|' -f1)
        if [ "$r" = "$region" ]; then
            echo "$entry" | cut -d'|' -f3
            return
        fi
    done
}

get_profile_description() {
    local profile="$1"
    for entry in "${PROFILES[@]}"; do
        local p=$(echo "$entry" | cut -d'|' -f1)
        if [ "$p" = "$profile" ]; then
            echo "$entry" | cut -d'|' -f2
            return
        fi
    done
}

print_header() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                        OSRM Enterprise Stack Setup                          ║"
    echo "║                   Self-Hosted Google Maps Alternative                       ║"
    echo "║                        Enhanced with Rich Features                          ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_dependencies() {
    print_step "Checking dependencies..."

    local missing_deps=()

    # Check for required commands
    for cmd in docker curl; do
        if ! command -v $cmd &>/dev/null; then
            missing_deps+=($cmd)
        fi
    done

    if [ ${#missing_deps[@]} -ne 0 ]; then
        print_error "Missing required dependencies: ${missing_deps[*]}"
        echo "Please install the missing dependencies and run the script again."
        exit 1
    fi

    # Check Docker version
    if ! docker --version | grep -q "Docker version"; then
        print_error "Docker is not properly installed or not running"
        exit 1
    fi

    # Check Docker Compose version (prefer v2 plugin, fallback to standalone)
    if docker compose version &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker compose"
    elif docker-compose --version &>/dev/null; then
        DOCKER_COMPOSE_CMD="docker-compose"
    else
        print_error "Docker Compose is not available"
        print_info "Please install Docker Compose or use Docker Desktop which includes it"
        exit 1
    fi

    print_info "All dependencies are satisfied"
    print_info "Using Docker Compose command: $DOCKER_COMPOSE_CMD"
}

check_system_resources() {
    print_step "Checking system resources..."

    # Check available memory
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        local total_mem=$(vm_stat | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
        local page_size=$(vm_stat | grep "page size" | awk '{print $8}')
        local available_gb=$((total_mem * page_size / 1024 / 1024 / 1024))
    else
        # Linux
        local available_gb=$(free -g | awk '/^Mem:/{print $7}')
    fi

    if [ "$available_gb" -lt 4 ]; then
        print_warning "Low available memory: ${available_gb}GB. Recommended: 8GB+"
        print_warning "Consider using a smaller region or increasing system memory"
    else
        print_info "Available memory: ${available_gb}GB"
    fi

    # Check available disk space
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        local available_space=$(df -h "$SCRIPT_DIR" | awk 'NR==2 {print $4}' | sed 's/[^0-9]//g')
    else
        # Linux
        local available_space=$(df -BG "$SCRIPT_DIR" | awk 'NR==2 {print $4}' | sed 's/G//')
    fi

    if [ -n "$available_space" ] && [ "$available_space" -lt 10 ]; then
        print_warning "Low disk space: ${available_space}GB. Recommended: 20GB+"
    else
        print_info "Available disk space: ${available_space}GB"
    fi
}

show_region_menu() {
    echo -e "${BLUE}Available regions:${NC}"
    local i=1
    for entry in "${REGIONS[@]}"; do
        local region=$(echo "$entry" | cut -d'|' -f1)
        local description=$(echo "$entry" | cut -d'|' -f3)
        echo "  $i) $region - $description"
        ((i++))
    done
    echo
}

show_profile_menu() {
    echo -e "${BLUE}Available routing profiles:${NC}"
    local i=1
    for entry in "${PROFILES[@]}"; do
        local profile=$(echo "$entry" | cut -d'|' -f1)
        local description=$(echo "$entry" | cut -d'|' -f2)
        echo "  $i) $profile - $description"
        ((i++))
    done
    echo
}

select_region() {
    if [ -n "$1" ]; then
        REGION="$1"
        local valid_region=false
        for entry in "${REGIONS[@]}"; do
            local region=$(echo "$entry" | cut -d'|' -f1)
            if [ "$region" = "$REGION" ]; then
                valid_region=true
                break
            fi
        done
        if [ "$valid_region" = false ]; then
            print_error "Invalid region: $REGION"
            show_region_menu
            exit 1
        fi
        return
    fi

    show_region_menu
    read -p "Select region (default: berlin): " region_choice

    if [ -z "$region_choice" ]; then
        REGION="berlin"
    elif [[ "$region_choice" =~ ^[0-9]+$ ]]; then
        local index=$((region_choice - 1))
        if [ $index -ge 0 ] && [ $index -lt ${#REGIONS[@]} ]; then
            REGION=$(echo "${REGIONS[$index]}" | cut -d'|' -f1)
        else
            print_error "Invalid selection"
            exit 1
        fi
    else
        REGION="$region_choice"
        local valid_region=false
        for entry in "${REGIONS[@]}"; do
            local region=$(echo "$entry" | cut -d'|' -f1)
            if [ "$region" = "$REGION" ]; then
                valid_region=true
                break
            fi
        done
        if [ "$valid_region" = false ]; then
            print_error "Invalid region: $REGION"
            exit 1
        fi
    fi
}

select_profile() {
    if [ -n "$1" ]; then
        PROFILE="$1"
        local valid_profile=false
        for entry in "${PROFILES[@]}"; do
            local profile=$(echo "$entry" | cut -d'|' -f1)
            if [ "$profile" = "$PROFILE" ]; then
                valid_profile=true
                break
            fi
        done
        if [ "$valid_profile" = false ]; then
            print_error "Invalid profile: $PROFILE"
            show_profile_menu
            exit 1
        fi
        return
    fi

    show_profile_menu
    read -p "Select routing profile (default: car): " profile_choice

    if [ -z "$profile_choice" ]; then
        PROFILE="car"
    elif [[ "$profile_choice" =~ ^[0-9]+$ ]]; then
        local index=$((profile_choice - 1))
        if [ $index -ge 0 ] && [ $index -lt ${#PROFILES[@]} ]; then
            PROFILE=$(echo "${PROFILES[$index]}" | cut -d'|' -f1)
        else
            print_error "Invalid selection"
            exit 1
        fi
    else
        PROFILE="$profile_choice"
        local valid_profile=false
        for entry in "${PROFILES[@]}"; do
            local profile=$(echo "$entry" | cut -d'|' -f1)
            if [ "$profile" = "$PROFILE" ]; then
                valid_profile=true
                break
            fi
        done
        if [ "$valid_profile" = false ]; then
            print_error "Invalid profile: $PROFILE"
            exit 1
        fi
    fi
}

create_directories() {
    print_step "Creating directory structure..."

    mkdir -p "$SCRIPT_DIR/data"
    mkdir -p "$SCRIPT_DIR/profiles"
    mkdir -p "$SCRIPT_DIR/logs"
    mkdir -p "$SCRIPT_DIR/nginx/logs"
    mkdir -p "$SCRIPT_DIR/ssl"
    mkdir -p "$SCRIPT_DIR/monitoring/grafana/dashboards"
    mkdir -p "$SCRIPT_DIR/monitoring/grafana/datasources"
    mkdir -p "$SCRIPT_DIR/api/logs"

    print_info "Directory structure created"
}

download_osm_data() {
    print_step "Downloading OpenStreetMap data for $REGION..."

    local url=$(get_region_url "$REGION")
    local filename="${REGION}-latest.osm.pbf"
    local filepath="$SCRIPT_DIR/data/$filename"

    if [ -f "$filepath" ]; then
        print_info "OSM data already exists: $filepath"
        read -p "Do you want to re-download? (y/N): " redownload
        if [[ ! "$redownload" =~ ^[Yy]$ ]]; then
            return
        fi
    fi

    print_info "Downloading from: $url"
    print_info "This may take a while depending on the region size..."

    # Use curl for downloading (wget not available by default on macOS)
    print_info "Downloading using curl..."
    curl -L -o "$filepath" "$url" --progress-bar

    if [ $? -eq 0 ]; then
        print_info "Download completed: $filepath"
        print_info "File size: $(du -h "$filepath" | cut -f1)"
    else
        print_error "Download failed"
        exit 1
    fi
}

prepare_osrm_data() {
    print_step "Preparing OSRM data with $PROFILE profile..."

    local osm_file="$SCRIPT_DIR/data/${REGION}-latest.osm.pbf"
    local osrm_file="$SCRIPT_DIR/data/map.osrm"
    local profile_file="$SCRIPT_DIR/profiles/${PROFILE}.lua"

    if [ ! -f "$osm_file" ]; then
        print_error "OSM file not found: $osm_file"
        exit 1
    fi

    if [ ! -f "$profile_file" ]; then
        print_error "Profile file not found: $profile_file"
        print_info "Available profiles in $SCRIPT_DIR/profiles:"
        ls -1 "$SCRIPT_DIR/profiles"/*.lua 2>/dev/null || echo "No profiles found"
        exit 1
    fi

    print_info "Using profile: $profile_file"
    print_info "Processing OSM data (this may take 30+ minutes for large regions)..."

    # Extract
    print_info "Step 1/3: Extracting..."
    docker run --rm -v "$SCRIPT_DIR:/data" osrm/osrm-backend:latest \
        osrm-extract -p "/data/profiles/${PROFILE}.lua" "/data/data/${REGION}-latest.osm.pbf"

    # Partition (for MLD algorithm)
    if [ "$ALGORITHM" = "mld" ]; then
        print_info "Step 2/3: Partitioning (MLD)..."
        docker run --rm -v "$SCRIPT_DIR:/data" osrm/osrm-backend:latest \
            osrm-partition "/data/data/${REGION}-latest.osrm"

        print_info "Step 3/3: Customizing (MLD)..."
        docker run --rm -v "$SCRIPT_DIR:/data" osrm/osrm-backend:latest \
            osrm-customize "/data/data/${REGION}-latest.osrm"
    else
        # Contraction Hierarchies
        print_info "Step 2/3: Contracting (CH)..."
        docker run --rm -v "$SCRIPT_DIR:/data" osrm/osrm-backend:latest \
            osrm-contract "/data/data/${REGION}-latest.osrm"
    fi

    # Move files to expected location
    mv "$SCRIPT_DIR/data/${REGION}-latest.osrm"* "$SCRIPT_DIR/data/"

    # Create symlink for map.osrm
    ln -sf "${REGION}-latest.osrm" "$SCRIPT_DIR/data/map.osrm"

    print_info "OSRM data preparation completed"
}

setup_ssl() {
    print_step "Setting up SSL certificates..."

    local ssl_dir="$SCRIPT_DIR/ssl"
    local cert_file="$ssl_dir/cert.pem"
    local key_file="$ssl_dir/key.pem"

    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
        print_info "SSL certificates already exist"
        return
    fi

    print_info "Generating self-signed SSL certificates..."

    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$key_file" \
        -out "$cert_file" \
        -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" \
        2>/dev/null

    if [ $? -eq 0 ]; then
        print_info "SSL certificates generated"
        print_warning "Using self-signed certificates. For production, use proper SSL certificates."
    else
        print_warning "Failed to generate SSL certificates. HTTPS will not be available."
    fi
}

start_services() {
    print_step "Starting OSRM Enterprise Stack..."

    # Pull latest images
    print_info "Pulling Docker images..."
    $DOCKER_COMPOSE_CMD pull

    # Build custom images
    print_info "Building custom images..."
    $DOCKER_COMPOSE_CMD build

    # Start services
    print_info "Starting services..."
    $DOCKER_COMPOSE_CMD up -d

    # Wait for services to be ready
    print_info "Waiting for services to start..."
    sleep 30

    # Check service health
    check_service_health
}

check_service_health() {
    print_step "Checking service health..."

    local services=("osrm-backend-1:5001" "osrm-backend-2:5002" "osrm-enterprise-api:3001" "osrm-frontend:9966")
    local healthy_services=0

    for service in "${services[@]}"; do
        local name=$(echo "$service" | cut -d':' -f1)
        local port=$(echo "$service" | cut -d':' -f2)

        if curl -sf "http://localhost:$port/health" >/dev/null 2>&1 ||
            curl -sf "http://localhost:$port/" >/dev/null 2>&1; then
            print_info "✓ $name is healthy"
            ((healthy_services++))
        else
            print_warning "✗ $name is not responding"
        fi
    done

    if [ $healthy_services -eq ${#services[@]} ]; then
        print_info "All services are healthy!"
    else
        print_warning "$healthy_services/${#services[@]} services are healthy"
    fi
}

show_access_info() {
    print_step "Setup completed! Access information:"

    echo -e "${GREEN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                            OSRM Enterprise Stack                            ║"
    echo "║                              Access Information                             ║"
    echo "╠══════════════════════════════════════════════════════════════════════════════╣"
    echo "║                                                                              ║"
    echo "║  🗺️  Frontend Demo:        http://localhost:9966                            ║"
    echo "║  🚀 Enhanced API:          http://localhost:3001                            ║"
    echo "║  📊 API Documentation:     http://localhost:3001/api-docs                   ║"
    echo "║  🔧 OSRM Backend 1:        http://localhost:5001                            ║"
    echo "║  🔧 OSRM Backend 2:        http://localhost:5002                            ║"
    echo "║  📈 Grafana Dashboard:     http://localhost:3000 (admin/admin)              ║"
    echo "║  📊 Prometheus Metrics:    http://localhost:9090                            ║"
    echo "║  🗄️  Redis Cache:           localhost:6379                                  ║"
    echo "║                                                                              ║"
    echo "║  Region: $REGION                                                              ║"
    echo "║  Profile: $PROFILE                                                           ║"
    echo "║  Algorithm: $ALGORITHM                                                       ║"
    echo "║                                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    echo -e "${BLUE}Features available:${NC}"
    echo "  • Interactive map interface with OpenStreetMap"
    echo "  • Multiple routing profiles (car, bicycle, foot)"
    echo "  • Turn-by-turn navigation"
    echo "  • Route optimization (TSP solver)"
    echo "  • Isochrone analysis"
    echo "  • Map matching for GPS traces"
    echo "  • Distance/duration matrices"
    echo "  • Real-time monitoring and metrics"
    echo "  • Load balancing and caching"
    echo "  • Progressive Web App (PWA) support"
    echo

    echo -e "${BLUE}Quick API examples:${NC}"
    echo "  # Health check"
    echo "  curl http://localhost:3001/health"
    echo
    echo "  # Simple route"
    echo "  curl 'http://localhost:3001/route?waypoints=[{\"lng\":13.388860,\"lat\":52.517037},{\"lng\":13.397634,\"lat\":52.529407}]'"
    echo
    echo "  # Find nearest road"
    echo "  curl 'http://localhost:3001/nearest?lat=52.517037&lng=13.388860'"
    echo

    echo -e "${YELLOW}Management commands:${NC}"
    echo "  # View logs"
    echo "  $DOCKER_COMPOSE_CMD logs -f"
    echo
    echo "  # Stop services"
    echo "  $DOCKER_COMPOSE_CMD down"
    echo
    echo "  # Restart services"
    echo "  $DOCKER_COMPOSE_CMD restart"
    echo
    echo "  # Update and rebuild"
    echo "  $DOCKER_COMPOSE_CMD down && $DOCKER_COMPOSE_CMD pull && $DOCKER_COMPOSE_CMD up -d --build"
    echo
}

show_help() {
    echo "OSRM Enterprise Stack Setup Script"
    echo
    echo "Usage: $0 [OPTIONS]"
    echo
    echo "Options:"
    echo "  -r, --region REGION     Set the region (default: berlin)"
    echo "  -p, --profile PROFILE   Set the routing profile (default: car)"
    echo "  -a, --algorithm ALGO    Set the algorithm (mld|ch, default: mld)"
    echo "  -m, --memory MEMORY     Set memory limit (default: 8G)"
    echo "  -h, --help              Show this help message"
    echo
    echo "Available regions:"
    for entry in "${REGIONS[@]}"; do
        local region=$(echo "$entry" | cut -d'|' -f1)
        local description=$(echo "$entry" | cut -d'|' -f3)
        echo "  $region - $description"
    done
    echo
    echo "Available profiles:"
    for entry in "${PROFILES[@]}"; do
        local profile=$(echo "$entry" | cut -d'|' -f1)
        local description=$(echo "$entry" | cut -d'|' -f2)
        echo "  $profile - $description"
    done
    echo
    echo "Examples:"
    echo "  $0                                    # Interactive setup"
    echo "  $0 -r california -p bicycle          # California with bicycle routing"
    echo "  $0 -r germany -p car -a ch           # Germany with car routing using CH algorithm"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
    -r | --region)
        REGION="$2"
        shift 2
        ;;
    -p | --profile)
        PROFILE="$2"
        shift 2
        ;;
    -a | --algorithm)
        ALGORITHM="$2"
        shift 2
        ;;
    -m | --memory)
        MEMORY_LIMIT="$2"
        shift 2
        ;;
    -h | --help)
        show_help
        exit 0
        ;;
    *)
        print_error "Unknown option: $1"
        show_help
        exit 1
        ;;
    esac
done

# Main execution
main() {
    print_header

    check_dependencies
    check_system_resources

    # Interactive selection if not provided via command line
    local valid_region=false
    for entry in "${REGIONS[@]}"; do
        local region=$(echo "$entry" | cut -d'|' -f1)
        if [ "$region" = "$REGION" ]; then
            valid_region=true
            break
        fi
    done
    if [ "$valid_region" = true ]; then
        print_info "Using region: $REGION"
    else
        select_region
    fi

    local valid_profile=false
    for entry in "${PROFILES[@]}"; do
        local profile=$(echo "$entry" | cut -d'|' -f1)
        if [ "$profile" = "$PROFILE" ]; then
            valid_profile=true
            break
        fi
    done
    if [ "$valid_profile" = true ]; then
        print_info "Using profile: $PROFILE"
    else
        select_profile
    fi

    print_info "Configuration:"
    print_info "  Region: $REGION"
    print_info "  Profile: $PROFILE"
    print_info "  Algorithm: $ALGORITHM"
    print_info "  Memory Limit: $MEMORY_LIMIT"
    echo

    read -p "Continue with setup? (Y/n): " confirm
    if [[ "$confirm" =~ ^[Nn]$ ]]; then
        print_info "Setup cancelled"
        exit 0
    fi

    create_directories
    download_osm_data
    prepare_osrm_data
    setup_ssl
    start_services
    show_access_info

    print_info "Setup completed successfully!"
    print_info "Your self-hosted Google Maps alternative is ready!"
}

# Run main function
main "$@"
