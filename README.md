# Usage-Based Billing API - Spike

A proof-of-concept implementation for usage-based billing using AWS API Gateway, serverless framework (osls fork), and AWS Athena for usage tracking.

## Features

- 🔑 **API Key Management** - Two example API keys with usage plans
- ☁️ **CloudFront Distribution** - Edge-level request handling and logging
- 📊 **Usage Tracking** - CloudFront access logs capture all requests with API key information
- 🗄️ **Log Storage** - S3 buckets for long-term CloudFront log storage
- 🔍 **Athena Integration** - Query CloudFront logs using SQL for usage calculation
- 🔄 **Real-time Processing** - Kinesis Firehose with Lambda transformation to Parquet
- ⚡ **Serverless** - Built with the serverless framework (osls fork)
- 🚀 **Node.js** - Lambda functions written in Node.js 20.x

## Architecture

```
Client Request (with x-api-key header)
        ↓
  CloudFront Distribution
                        ↓
                  CloudFront Real-time Logs → Kinesis Stream
                        ↓
                  Kinesis Firehose (with Lambda transformation)
                        ↓
                  S3 (Parquet format, partitioned by date)
                        ↓
                  AWS Athena (SQL queries with api_key column)
                        ↓
                  DynamoDB (aggregated usage metrics)
        ↓
    API Gateway
        ↓
  Lambda Function
```

## Prerequisites

- Node.js 22+ and npm
- AWS CLI configured with appropriate credentials
- AWS account with permissions for:
  - API Gateway
  - Lambda
  - CloudWatch Logs
  - S3
  - AWS Glue
  - AWS Athena

## Installation

```bash
npm install
```

## Deployment

Deploy to AWS:

```bash
npm run deploy
```

Deploy to a specific stage:

```bash
serverless deploy --stage prod
```

## Usage

After deployment, you'll receive:
- API endpoint URL
- Two API key IDs

### Get API Keys

```bash
aws apigateway get-api-keys --include-values
```

### Make a Request

After deployment, use the **CloudFront domain** (not API Gateway directly) for all requests:

```bash
# GET request via CloudFront
curl -X GET https://your-cloudfront-id.cloudfront.net/example \
  -H "x-api-key: your-api-key-here"

# POST request via CloudFront
curl -X POST https://your-cloudfront-id.cloudfront.net/data \
  -H "x-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

**Important:** Always use the CloudFront URL (not API Gateway URL directly) to ensure requests are logged for billing.

## Tracking Usage

### Real-time Logs with API Key Extraction ✅

The system now includes **CloudFront real-time logs** with full header capture, enabling accurate usage-based billing by API key.

**Key Features:**
- ✅ Captures `X-Api-Key` header from requests
- ✅ Parquet format (70-90% cost reduction vs JSON)
- ✅ 43 comprehensive billing fields
- ✅ Automatic partition projection
- ✅ Near real-time delivery (< 30 seconds)

### Quick Usage Queries

```bash
# Query today's usage for all API keys
node scripts/query-usage.js --date 2025-10-05

# Query specific API key
node scripts/query-usage.js --date 2025-10-05 --api-key YOUR_API_KEY

# Calculate billing with geographic pricing
node scripts/query-usage.js --date 2025-10-05 --billing

# Calculate with cache hit discounts (40% off for cache hits)
node scripts/query-usage.js --date 2025-10-05 --cache-discount
```

### Athena SQL Queries

Query usage by API key:

```sql
SELECT
  FROM_UNIXTIME(timestamp/1000) as request_time,
  api_key,
  cs_uri_stem,
  sc_bytes,
  sc_status,
  x_edge_result_type
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
  AND api_key IS NOT NULL
LIMIT 10
```

### Documentation

- **[ATHENA_QUERIES.md](./docs/ATHENA_QUERIES.md)** - 14 comprehensive query examples
- **[REALTIME_LOGS.md](./docs/REALTIME_LOGS.md)** - Real-time logs architecture
- **[scripts/README.md](./scripts/README.md)** - CLI tool usage guide
- **[USAGE_TRACKING.md](./USAGE_TRACKING.md)** - Detailed usage tracking options

### Quick Start: View Logs

```bash
# View function logs
npm run logs

# Or using serverless directly
serverless logs -f example -t
```

## Project Structure

```
.
├── src/
│   └── handlers/
│       ├── example.js      # GET endpoint handler
│       └── another.js      # POST endpoint handler
├── serverless.yml          # Serverless framework configuration
├── package.json
├── README.md
└── USAGE_TRACKING.md       # Detailed usage tracking documentation
```

## API Endpoints

### GET /example
Example endpoint that returns a simple JSON response.

**Headers Required:**
- `x-api-key`: Your API key

**Response:**
```json
{
  "message": "Example endpoint response",
  "timestamp": "2025-10-04T01:23:45.678Z",
  "apiKeyId": "abc123xyz"
}
```

### POST /data
Example endpoint that accepts and echoes JSON data.

**Headers Required:**
- `x-api-key`: Your API key
- `Content-Type`: application/json

**Response:**
```json
{
  "message": "Data received successfully",
  "timestamp": "2025-10-04T01:23:45.678Z",
  "apiKeyId": "abc123xyz",
  "dataReceived": { "test": "data" }
}
```

## Configuration

The `serverless.yml` includes:

- **CloudFront Distribution**: Sits in front of API Gateway with real-time logging
- **CloudFront Real-time Logs**: Captures all requests with headers to Kinesis
- **Kinesis Stream**: Receives real-time CloudFront logs
- **Kinesis Firehose**: Transforms and delivers logs to S3 in Parquet format
- **Lambda Transformation**: Extracts API key from headers during Firehose processing
- **API Keys**: Two pre-configured API keys for testing
- **Usage Plan**: Configured with quota (10,000 requests/month) and throttling (100 req/sec)
- **S3 Buckets**: For real-time logs (Parquet), standard logs, and Athena results
- **AWS Glue Database**: For Athena table definitions
- **AWS Glue Tables**: Pre-configured schemas with partition projection
- **DynamoDB Table**: Stores aggregated daily usage metrics by API key

## Next Steps

This spike focuses on the CloudFront-based usage tracking mechanism. Future enhancements:

1. **Billing Integration**:
   - Integrate with Stripe, AWS Marketplace, or custom billing system
   - Define pricing tiers (requests + bandwidth)
   - Generate invoices based on CloudFront log data

4. **Monitoring & Alerting**:
   - CloudWatch dashboards for usage metrics
   - Alerts for quota limits or anomalies
   - Cache efficiency monitoring

5. **Optimization**:
   - Configure cache behaviors for different endpoints
   - Implement cache invalidation strategies
   - Fine-tune CloudFront Function performance

## Cleanup

Before removing the stack, empty all S3 buckets:

```bash
# Empty all buckets (requires --confirm flag)
node scripts/teardown.js --confirm
```

Then remove all deployed resources:

```bash
serverless remove
```

**Note**:
- S3 buckets must be empty before they can be deleted
- The teardown script empties all three buckets (CloudFront logs, real-time logs, Athena results)
- CloudFront distributions take 15-20 minutes to fully delete

## License

MIT
