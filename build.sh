#!/bin/sh

set -e

echo "Testing for running docker"
docker ps > /dev/null

echo "Building jar"
./gradlew build

echo "Building docker image"
docker buildx build --platform linux/amd64 --push -t d3v01d/misc-server:latest .
