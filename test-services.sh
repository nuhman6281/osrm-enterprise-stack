#!/bin/bash

# OSRM Enterprise Services Test Script
echo "🚀 Testing OSRM Enterprise Services..."
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
BASE_URL="http://localhost"
API_URL="http://localhost:3003"
TIMEOUT=10

# Test coordinates (Berlin)
START_LON=13.388860
START_LAT=52.517037
END_LON=13.397634
END_LAT=52.529407

# Function to test HTTP endpoint
test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_status="${3:-200}"

    echo -n "Testing $name... "

    response=$(curl -s -w "%{http_code}" -o /tmp/response.json --connect-timeout $TIMEOUT "$url" 2>/dev/null)
    status_code="${response: -3}"

    if [ "$status_code" = "$expected_status" ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $status_code)"
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $status_code, expected $expected_status)"
        return 1
    fi
}

# Function to test JSON API endpoint
test_json_endpoint() {
    local name="$1"
    local url="$2"
    local expected_field="$3"

    echo -n "Testing $name... "

    response=$(curl -s --connect-timeout $TIMEOUT "$url" 2>/dev/null)

    if echo "$response" | jq -e ".$expected_field" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC} (JSON response valid)"
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Invalid JSON or missing field: $expected_field)"
        echo "Response: $response" | head -c 200
        echo
        return 1
    fi
}

# Function to test POST endpoint
test_post_endpoint() {
    local name="$1"
    local url="$2"
    local data="$3"
    local expected_field="$4"

    echo -n "Testing $name... "

    response=$(curl -s --connect-timeout $TIMEOUT \
        -H "Content-Type: application/json" \
        -d "$data" \
        "$url" 2>/dev/null)

    if echo "$response" | jq -e ".$expected_field" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC} (JSON response valid)"
        return 0
    else
        echo -e "${RED}✗ FAIL${NC} (Invalid JSON or missing field: $expected_field)"
        echo "Response: $response" | head -c 200
        echo
        return 1
    fi
}

echo -e "${BLUE}1. Testing Core Infrastructure${NC}"
echo "--------------------------------"

# Test main proxy
test_endpoint "Main Proxy Health" "$BASE_URL/health"

# Test frontend
test_endpoint "Frontend Demo" "$BASE_URL/" 200

# Test API health
test_endpoint "API Health Check" "$API_URL/health"

# Test Redis
echo -n "Testing Redis... "
if docker exec osrm-redis redis-cli ping >/dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS${NC} (Redis responding)"
else
    echo -e "${RED}✗ FAIL${NC} (Redis not responding)"
fi

echo
echo -e "${BLUE}2. Testing OSRM Backend Services${NC}"
echo "--------------------------------"

# Test OSRM backend health
test_endpoint "OSRM Backend 1" "http://localhost:5001/health"
test_endpoint "OSRM Backend 2" "http://localhost:5002/health"

# Test load balancer
test_endpoint "Load Balancer" "http://localhost:3003/api/v1/health"

echo
echo -e "${BLUE}3. Testing Routing APIs${NC}"
echo "------------------------"

# Test basic route
ROUTE_URL="$API_URL/api/v1/route/v1/driving/$START_LON,$START_LAT;$END_LON,$END_LAT?overview=false"
test_json_endpoint "Basic Route" "$ROUTE_URL" "routes"

# Test enhanced route
ENHANCED_ROUTE_DATA="{\"coordinates\":[[$START_LON,$START_LAT],[$END_LON,$END_LAT]],\"profile\":\"car\"}"
test_post_endpoint "Enhanced Route" "$API_URL/api/v2/route/advanced" "$ENHANCED_ROUTE_DATA" "routes"

# Test table service
TABLE_URL="$API_URL/api/v1/table/v1/driving/$START_LON,$START_LAT;$END_LON,$END_LAT"
test_json_endpoint "Distance Table" "$TABLE_URL" "durations"

# Test nearest service
NEAREST_URL="$API_URL/api/v1/nearest/v1/driving/$START_LON,$START_LAT"
test_json_endpoint "Nearest Roads" "$NEAREST_URL" "waypoints"

echo
echo -e "${BLUE}4. Testing Enhanced Features${NC}"
echo "-----------------------------"

# Test isochrone
ISOCHRONE_DATA="{\"coordinates\":[$START_LON,$START_LAT],\"contours\":[300,600]}"
test_post_endpoint "Isochrone Analysis" "$API_URL/api/v2/isochrone" "$ISOCHRONE_DATA" "features"

# Test fleet management
FLEET_DATA="{\"vehicles\":[{\"id\":\"v1\",\"location\":[$START_LON,$START_LAT]}],\"jobs\":[{\"id\":\"j1\",\"location\":[$END_LON,$END_LAT]}]}"
test_post_endpoint "Fleet Optimization" "$API_URL/api/v2/fleet/optimize" "$FLEET_DATA" "solution"

echo
echo -e "${BLUE}5. Testing Monitoring Stack${NC}"
echo "----------------------------"

# Test Prometheus
test_endpoint "Prometheus" "http://localhost:9090/-/healthy"

# Test Grafana
test_endpoint "Grafana" "http://localhost:3000/api/health"

# Test exporters
test_endpoint "Node Exporter" "http://localhost:9100/metrics" 200
test_endpoint "Redis Exporter" "http://localhost:9121/metrics" 200

echo
echo -e "${BLUE}6. Performance Tests${NC}"
echo "--------------------"

# Test response times
echo -n "Testing API response time... "
start_time=$(date +%s%N)
curl -s "$API_URL/health" >/dev/null
end_time=$(date +%s%N)
duration=$(((end_time - start_time) / 1000000))

if [ $duration -lt 1000 ]; then
    echo -e "${GREEN}✓ PASS${NC} (${duration}ms)"
else
    echo -e "${YELLOW}⚠ SLOW${NC} (${duration}ms)"
fi

# Test concurrent requests
echo -n "Testing concurrent requests... "
for i in {1..5}; do
    curl -s "$API_URL/health" >/dev/null &
done
wait

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ PASS${NC} (Handled concurrent requests)"
else
    echo -e "${RED}✗ FAIL${NC} (Failed concurrent requests)"
fi

echo
echo -e "${BLUE}7. Security Tests${NC}"
echo "------------------"

# Test CORS headers
echo -n "Testing CORS headers... "
cors_header=$(curl -s -H "Origin: http://example.com" -I "$API_URL/health" | grep -i "access-control-allow-origin")
if [ -n "$cors_header" ]; then
    echo -e "${GREEN}✓ PASS${NC} (CORS headers present)"
else
    echo -e "${YELLOW}⚠ WARNING${NC} (No CORS headers found)"
fi

# Test rate limiting
echo -n "Testing rate limiting... "
rate_limit_header=$(curl -s -I "$API_URL/health" | grep -i "x-ratelimit")
if [ -n "$rate_limit_header" ]; then
    echo -e "${GREEN}✓ PASS${NC} (Rate limiting active)"
else
    echo -e "${YELLOW}⚠ WARNING${NC} (No rate limiting headers)"
fi

echo
echo "=================================="
echo -e "${GREEN}🎉 Test Suite Complete!${NC}"
echo

# Summary
echo -e "${BLUE}Service URLs:${NC}"
echo "• Demo Interface: http://localhost/"
echo "• API Documentation: http://localhost:3003/docs"
echo "• Prometheus: http://localhost:9090"
echo "• Grafana: http://localhost:3000 (admin/admin)"
echo "• Redis: localhost:6379"
echo

echo -e "${BLUE}Quick Test Commands:${NC}"
echo "• curl http://localhost:3003/health"
echo "• curl \"http://localhost:3003/api/v1/route/v1/driving/13.388860,52.517037;13.397634,52.529407\""
echo "• docker logs osrm-enterprise-api"
echo "• docker stats"

echo
echo -e "${YELLOW}Note: If any tests failed, check the logs with:${NC}"
echo "docker-compose logs [service-name]"
