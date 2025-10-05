#!/bin/bash

# Download CloudFront logs from S3 and unzip them

BUCKET="usage-billing-api-dev-cloudfront-logs-253490764618"
PREFIX="cloudfront-logs/"
LOCAL_DIR="./logs"

echo "📥 Downloading CloudFront logs from S3..."
aws s3 sync s3://${BUCKET}/${PREFIX} ${LOCAL_DIR}/

echo "📦 Unzipping .gz files..."
for file in ${LOCAL_DIR}/*.gz; do
  if [ -f "$file" ]; then
    echo "Unzipping: $file"
    gunzip -f "$file"
  fi
done

echo "✅ Done! Logs are in ${LOCAL_DIR}/"
