#!/bin/bash

# Generate SSL certificates for OSRM Enterprise
echo "Generating SSL certificates for OSRM Enterprise..."

# Create SSL directory if it doesn't exist
mkdir -p ssl

# Generate private key
openssl genrsa -out ssl/server.key 2048

# Generate certificate signing request
openssl req -new -key ssl/server.key -out ssl/server.csr -subj "/C=US/ST=State/L=City/O=OSRM Enterprise/OU=IT Department/CN=localhost"

# Generate self-signed certificate
openssl x509 -req -days 365 -in ssl/server.csr -signkey ssl/server.key -out ssl/server.crt

# Generate DH parameters for better security
openssl dhparam -out ssl/dhparam.pem 2048

# Set proper permissions
chmod 600 ssl/server.key
chmod 644 ssl/server.crt ssl/dhparam.pem

echo "SSL certificates generated successfully!"
echo "Certificate: ssl/server.crt"
echo "Private Key: ssl/server.key"
echo "DH Parameters: ssl/dhparam.pem"

# Clean up CSR file
rm ssl/server.csr
