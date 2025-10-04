# Usage-Based Billing Tracking

This document outlines the approach for tracking API usage for billing purposes using AWS API Gateway logs.

## Overview

The API is configured with:
- **API Gateway** with API keys for customer identification
- **CloudWatch Logs** for capturing all API requests
- **AWS Athena** for querying usage data (recommended approach)
- **S3** for long-term log storage

## Log Querying Options

### Option 1: AWS Athena (Recommended) ✅

**Pros:**
- Industry standard for log analytics at scale
- SQL-based queries - familiar and powerful
- Cost-effective for large datasets (pay per query, not per hour)
- No infrastructure to manage
- Can handle petabyte-scale data
- Direct S3 integration

**Cons:**
- Slight learning curve for query optimization
- Query latency (not real-time, but typically 1-5 seconds)

**Best for:** Production usage-based billing systems with large volumes of API calls

### Option 2: CloudWatch Logs Insights

**Pros:**
- Built-in to CloudWatch (no additional setup)
- Real-time or near real-time queries
- Simple query language
- Good for quick analysis

**Cons:**
- More expensive at scale
- Limited to CloudWatch retention period (default 30 days)
- Less powerful than SQL for complex aggregations
- Not ideal for historical billing data

**Best for:** Real-time monitoring and short-term usage analysis

### Option 3: Custom Lambda + DynamoDB

**Pros:**
- Real-time tracking
- Can implement custom business logic
- Fast lookups for current billing period

**Cons:**
- More infrastructure to manage
- Higher operational cost
- Requires building custom aggregation logic
- Potential for data loss if not designed properly

**Best for:** Real-time usage dashboards or complex business logic

### Option 4: Kinesis Data Firehose + S3 + Athena

**Pros:**
- Near real-time data delivery to S3
- Automatic data transformation and partitioning
- Scales automatically
- Best of both worlds (real-time + Athena)

**Cons:**
- More complex setup
- Additional cost for Firehose

**Best for:** High-volume APIs requiring both real-time monitoring and historical analysis

## Recommended Architecture

For this project, we recommend **AWS Athena** with the following setup:

1. **API Gateway → CloudWatch Logs** (enabled automatically)
2. **CloudWatch Logs → S3** (via subscription filter)
3. **AWS Glue** (creates table schema for logs)
4. **AWS Athena** (queries S3 data)

## Implementation Status

### Completed
- ✅ API Gateway with API keys configured
- ✅ CloudWatch Logs enabled with full execution logging
- ✅ S3 bucket created for log storage
- ✅ AWS Glue database created
- ✅ Athena results bucket configured

### Next Steps (Not Implemented Yet)
- ⏳ CloudWatch Logs subscription filter to export to S3
- ⏳ AWS Glue crawler to auto-discover log schema
- ⏳ Athena table creation for querying
- ⏳ Example Athena queries for usage aggregation
- ⏳ Lambda function for periodic usage calculation
- ⏳ Actual billing integration (future phase)

## Example Usage Tracking Flow

1. **Client makes API request** with API key
2. **API Gateway logs request** to CloudWatch including:
   - API Key ID
   - Timestamp
   - Request path
   - Method
   - Response size
   - Latency
   - Source IP
3. **Logs are exported to S3** (via subscription filter)
4. **Athena queries S3 data** to calculate usage:
   - Count requests per API key
   - Measure data transfer per API key
   - Calculate costs based on usage tiers
5. **Billing system** uses query results to generate invoices

## Sample Athena Queries

Once the Glue table is created, you can use queries like:

```sql
-- Count API calls per API key for the current month
SELECT
  apiKeyId,
  COUNT(*) as total_requests,
  SUM(responseLatency) as total_latency_ms
FROM api_gateway_logs
WHERE year = 2025 AND month = 10
GROUP BY apiKeyId
ORDER BY total_requests DESC;

-- Calculate data transfer per API key
SELECT
  apiKeyId,
  SUM(requestSize + responseSize) / 1024 / 1024 as total_mb_transferred
FROM api_gateway_logs
WHERE year = 2025 AND month = 10
GROUP BY apiKeyId;

-- Track usage by endpoint
SELECT
  apiKeyId,
  resourcePath,
  COUNT(*) as request_count
FROM api_gateway_logs
WHERE year = 2025 AND month = 10
GROUP BY apiKeyId, resourcePath;
```

## Cost Estimation

Based on industry best practices for usage-based billing:

**Athena Costs:**
- $5 per TB of data scanned
- With partitioning and compression: ~$0.01-0.10 per billing calculation
- For 1M API calls/month: ~$1-5/month in query costs

**CloudWatch Logs:**
- $0.50 per GB ingested
- $0.03 per GB stored per month
- For 1M API calls/month (~10GB): ~$5-10/month

**S3 Storage:**
- $0.023 per GB/month (Standard)
- Negligible for log storage (~$1-2/month)

## References

- [AWS API Gateway Logging Best Practices](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html)
- [AWS Athena for Log Analytics](https://docs.aws.amazon.com/athena/latest/ug/cloudwatch-logs.html)
- [Usage Plans and API Keys](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html)
