# Usage-Based Billing API - Spike

A proof-of-concept implementation for usage-based billing using AWS API Gateway, serverless framework (osls fork), and AWS Athena for usage tracking.

## Features

- 🔑 **API Key Management** - Two example API keys with usage plans
- 📊 **Usage Tracking** - CloudWatch Logs capture all API requests with API key information
- 🗄️ **Log Storage** - S3 buckets for long-term log storage
- 🔍 **Athena Integration** - Query logs using SQL for usage calculation
- ⚡ **Serverless** - Built with the serverless framework (osls fork)
- 🚀 **Node.js** - Lambda functions written in Node.js 20.x

## Architecture

```
Client Request (with API Key)
        ↓
    API Gateway
        ↓
  Lambda Function
        ↓
   CloudWatch Logs → S3 → AWS Athena
        ↓
  Usage Calculation
```

## Prerequisites

- Node.js 18+ and npm
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

```bash
# GET request
curl -X GET https://your-api-id.execute-api.us-east-1.amazonaws.com/dev/example \
  -H "x-api-key: your-api-key-here"

# POST request
curl -X POST https://your-api-id.execute-api.us-east-1.amazonaws.com/dev/data \
  -H "x-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

## Tracking Usage

See [USAGE_TRACKING.md](./USAGE_TRACKING.md) for detailed information on:
- Log querying options (Athena, CloudWatch Insights, etc.)
- Architecture recommendations
- Example Athena queries
- Cost estimations

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

- **API Gateway Logging**: Full execution data and access logging enabled
- **API Keys**: Two pre-configured API keys for testing
- **Usage Plan**: Configured with quota (10,000 requests/month) and throttling (100 req/sec)
- **CloudWatch Logs**: Retention period of 30 days
- **S3 Buckets**: For log storage and Athena query results
- **AWS Glue Database**: For Athena table definitions

## Next Steps

This spike focuses on the usage tracking mechanism. Future enhancements:

1. **Complete Athena Setup**:
   - Add CloudWatch Logs subscription filter to export to S3
   - Create AWS Glue crawler for automatic schema discovery
   - Define Athena tables for querying

2. **Usage Aggregation**:
   - Lambda function to run periodic usage calculations
   - Store aggregated usage in DynamoDB or RDS

3. **Billing Integration**:
   - Integrate with Stripe, AWS Marketplace, or custom billing system
   - Define pricing tiers and calculate costs
   - Generate invoices

4. **Monitoring & Alerting**:
   - CloudWatch dashboards for usage metrics
   - Alerts for quota limits or anomalies

## Cleanup

Remove all deployed resources:

```bash
serverless remove
```

**Note**: S3 buckets must be empty before they can be deleted. You may need to manually empty the log buckets.

## License

MIT
