#!/bin/sh

set -e

echo "Building"
./gradlew build

echo "Tagging latest as stable"
docker buildx build --platform linux/amd64 --push -t d3v01d/misc-server:stable .
