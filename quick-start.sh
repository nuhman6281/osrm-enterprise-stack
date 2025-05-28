#!/bin/bash

# Quick Start Script for OSRM Demo
# This script sets up OSRM with Berlin data for quick testing

set -e

echo "🚀 OSRM Quick Start - Setting up Berlin demo..."

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Run the main setup script with Berlin (small dataset for quick testing)
echo "📥 Setting up OSRM with Berlin data..."
./setup.sh -r berlin -p car

echo ""
echo "✅ Quick start completed!"
echo ""
echo "🌐 Access your services:"
echo "   Frontend:     http://localhost:9966"
echo "   API:          http://localhost:5001"
echo "   Enhanced API: http://localhost:3001"
echo "   Demo:         Open demo/index.html in your browser"
echo "   Grafana:      http://localhost:3000 (admin/admin123)"
echo ""
echo "🧪 Test the API:"
echo "   curl 'http://localhost:5001/api/route/v1/driving/13.388860,52.517037;13.397634,52.529407'"
echo ""
echo "📊 Monitor with:"
echo "   docker-compose logs -f"
echo ""
echo "🛑 Stop services:"
echo "   docker-compose down"
