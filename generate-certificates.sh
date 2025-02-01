#!/bin/bash

# Create certificates directory if it doesn't exist
mkdir -p certificates

# Generate private key
openssl genrsa -out certificates/key.pem 2048

# Generate certificate
openssl req -new -x509 -key certificates/key.pem -out certificates/cert.pem -days 365 -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

# Set permissions
chmod 600 certificates/key.pem
chmod 600 certificates/cert.pem

echo "Certificates generated successfully!"
