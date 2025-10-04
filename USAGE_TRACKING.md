# Usage-Based Billing Tracking

This document outlines the approach for tracking API usage for billing purposes using AWS CloudFront access logs.

## Overview

The API is configured with:
- **CloudFront Distribution** in front of API Gateway for edge-level request tracking
- **CloudFront Access Logs** for capturing all requests at the edge (before API Gateway)
- **CloudFront Function** to extract API keys from headers and add to query strings for logging
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

For this project, we use **CloudFront + AWS Athena** with the following setup:

1. **Client → CloudFront Distribution** (with API key in x-api-key header)
2. **CloudFront Function** (extracts API key and adds to query string for logging)
3. **CloudFront → API Gateway → Lambda** (request processing)
4. **CloudFront Access Logs → S3** (automatic, free logging)
5. **AWS Glue Table** (defines schema for CloudFront logs)
6. **AWS Athena** (queries S3 data using SQL)

## Implementation Status

### Completed
- ✅ API Gateway with API keys configured
- ✅ CloudFront distribution in front of API Gateway
- ✅ CloudFront access logging to S3 bucket
- ✅ CloudFront Function to extract API key from headers
- ✅ S3 bucket for CloudFront log storage (with lifecycle policy)
- ✅ AWS Glue database created
- ✅ AWS Glue table for CloudFront logs (with full schema)
- ✅ Athena results bucket configured

### Next Steps (Not Implemented Yet)
- ⏳ Add partitions to Glue table for efficient querying
- ⏳ Lambda function for periodic usage calculation
- ⏳ Actual billing integration (future phase)

## Example Usage Tracking Flow

1. **Client makes API request** to CloudFront with `x-api-key` header
2. **CloudFront Function** extracts API key from header and adds to query string as `cf_api_key`
3. **CloudFront logs request** to S3 including:
   - API Key (from cf_api_key query param)
   - Timestamp and date
   - Request path (cs_uri_stem)
   - Query string (cs_uri_query)
   - Method (cs_method)
   - Response size (sc_bytes)
   - Request size (cs_bytes)
   - Time taken
   - Cache hit/miss status
   - Edge location
   - Source IP
4. **Logs are written to S3** automatically (free, within minutes to hours)
5. **Athena queries S3 data** to calculate usage:
   - Count requests per API key
   - Measure data transfer per API key
   - Track cache efficiency
   - Calculate costs based on usage tiers
6. **Billing system** uses query results to generate invoices

## Sample Athena Queries

Once the Glue table is created and logs are flowing, you can use queries like:

```sql
-- Extract API key from query string and count requests per key
SELECT
  regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1) as api_key,
  COUNT(*) as total_requests,
  SUM(sc_bytes) / 1024 / 1024 as total_mb_sent,
  SUM(cs_bytes) / 1024 / 1024 as total_mb_received,
  AVG(time_taken) as avg_response_time
FROM cloudfront_logs
WHERE year = '2025' AND month = '10'
  AND cs_uri_query LIKE '%cf_api_key=%'
GROUP BY regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1)
ORDER BY total_requests DESC;

-- Calculate total data transfer per API key (for bandwidth billing)
SELECT
  regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1) as api_key,
  SUM(sc_bytes + cs_bytes) / 1024 / 1024 / 1024 as total_gb_transferred,
  COUNT(*) as request_count
FROM cloudfront_logs
WHERE year = '2025' AND month = '10'
  AND cs_uri_query LIKE '%cf_api_key=%'
GROUP BY regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1);

-- Track usage by endpoint and API key
SELECT
  regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1) as api_key,
  cs_uri_stem as endpoint,
  cs_method as method,
  COUNT(*) as request_count,
  SUM(sc_bytes) / 1024 as total_kb_sent
FROM cloudfront_logs
WHERE year = '2025' AND month = '10'
  AND cs_uri_query LIKE '%cf_api_key=%'
GROUP BY
  regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1),
  cs_uri_stem,
  cs_method
ORDER BY request_count DESC;

-- Cache efficiency per API key
SELECT
  regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1) as api_key,
  x_edge_result_type as cache_status,
  COUNT(*) as request_count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1)) as percentage
FROM cloudfront_logs
WHERE year = '2025' AND month = '10'
  AND cs_uri_query LIKE '%cf_api_key=%'
GROUP BY
  regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1),
  x_edge_result_type;

-- Add partitions for a specific day (run this after logs are generated)
ALTER TABLE cloudfront_logs ADD IF NOT EXISTS
PARTITION (year='2025', month='10', day='04')
LOCATION 's3://your-bucket-name/cloudfront-logs/2025/10/04/';
```

## Cost Estimation

Based on industry best practices for usage-based billing:

**CloudFront Costs:**
- Data transfer: $0.085 per GB (first 10TB, US)
- HTTP/HTTPS requests: $0.0075-0.01 per 10,000 requests
- CloudFront Functions: $0.10 per 1M invocations
- **Logging: FREE** ✅

**Athena Costs:**
- $5 per TB of data scanned
- With partitioning and compression: ~$0.01-0.10 per billing calculation
- For 1M API calls/month: ~$1-5/month in query costs

**S3 Storage (CloudFront Logs):**
- $0.023 per GB/month (Standard)
- CloudFront logs are smaller than API Gateway logs
- For 1M API calls/month (~2-5GB): ~$0.05-0.15/month

**Total Estimated Cost for 1M API calls/month:**
- CloudFront: ~$10-20 (mainly data transfer)
- Logging & Storage: ~$0.05-0.15
- Athena queries: ~$1-5
- **Total: ~$11-25/month**

**Key Advantage:** CloudFront logging is FREE vs CloudWatch Logs at $0.50/GB ingestion

## References

- [CloudFront Access Logs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/AccessLogs.html)
- [CloudFront Functions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html)
- [AWS Athena for Log Analytics](https://docs.aws.amazon.com/athena/latest/ug/cloudfront-logs.html)
- [Usage Plans and API Keys](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html)
- [Querying CloudFront Logs with Athena](https://docs.aws.amazon.com/athena/latest/ug/cloudfront-logs.html)
