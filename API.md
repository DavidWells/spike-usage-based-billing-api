# Usage Billing API

Below are a list of callable endpoints for easy manual testing. You must have [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) installed in VSCode, Windsurf or Cursor.

## API settings

These are variables used in the requests below.

```ini
@localUrl = http://localhost:3000/dev
@remoteUrl = https://irnczgurfj.execute-api.us-east-1.amazonaws.com/dev
@cloudfrontUrl = https://d3o60fb1dwgq5k.cloudfront.net
# Swap out the base URL for local/remote dev
@baseUrl = {{cloudfrontUrl}}
# API Keys for testing (from serverless info output)
@apiKey1 = pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx
@apiKey2 = GYGtqyWIyD1vdVJ3E3L6j4w9kxAe3Bld1zaBMqV1
```

## API Requests

Here are the callable endpoints

### Get example endpoint (requires API key)

```http
# @name getExample
GET {{baseUrl}}/example
x-api-key: {{apiKey1}}
```

### Post data to another example endpoint (requires API key)

```http
# @name postData
POST {{baseUrl}}/data
Content-Type: application/json
x-api-key: {{apiKey1}}

{
  "message": "Test data for usage tracking",
  "userId": "user123",
  "action": "api_call"
}
```

### Get usage metrics for billing

```http
# @name getUsage
GET {{baseUrl}}/usage?api_key={{apiKey1}}&month=2025-01
```

### Test with second API key

```http
# @name getExampleWithKey2
GET {{baseUrl}}/example
x-api-key: {{apiKey2}}
```

### Post data with second API key

```http
# @name postDataWithKey2
POST {{baseUrl}}/data
Content-Type: application/json
x-api-key: {{apiKey2}}

{
  "message": "Test data for customer 2",
  "userId": "user456",
  "action": "api_call"
}
```

### Get usage for second API key

```http
# @name getUsageKey2
GET {{baseUrl}}/usage?api_key={{apiKey2}}&month=2025-01
```

### Test through CloudFront (recommended for production)

```http
# @name getExampleCloudFront
GET {{cloudfrontUrl}}/example
x-api-key: {{apiKey1}}
```

### Post data through CloudFront

```http
# @name postDataCloudFront
POST {{cloudfrontUrl}}/data
Content-Type: application/json
x-api-key: {{apiKey1}}

{
  "message": "Test data through CloudFront",
  "userId": "user789",
  "action": "cloudfront_api_call"
}
```

## Usage Tracking Notes

- All endpoints except `/usage` require an `x-api-key` header
- API keys are tracked for billing purposes
- Usage data is automatically rolled up daily via Athena queries
- CloudFront logs are used to track actual usage for billing
- The `/usage` endpoint returns aggregated metrics from DynamoDB

## Available API Keys

From the serverless deployment:
- **API Key 1**: `zjlfqf7sfa` (Customer 1)
- **API Key 2**: `kxpkvi4e1m` (Customer 2)

## Usage Plan Details

- **Quota**: 10,000 requests per month
- **Rate Limit**: 100 requests per second
- **Burst Limit**: 200 requests
- **Period**: Monthly

## Infrastructure Components

- **CloudFront Distribution**: `d3o60fb1dwgq5k.cloudfront.net`
- **DynamoDB Table**: `usage-billing-api-dev-usage-metrics`
- **Athena Database**: `usage-billing-api_dev_usage_db`
- **S3 Logs Bucket**: `usage-billing-api-dev-cloudfront-logs-253490764618`
