# CloudFront Real-time Logs

This document describes the CloudFront real-time logs setup for capturing API key headers and usage metrics.

## Overview

The system uses CloudFront real-time logs to capture the `cs-headers` field, which includes the `x-api-key` header sent by clients. This is necessary because:

1. **Standard CloudFront logs don't include headers** - Basic CloudFront access logs only contain fields like IP address, URI, query strings, etc., but NOT request headers.
2. **CloudFront Functions run after logging** - The CloudFrontApiKeyFunction that adds the API key to the query string runs AFTER basic logs are captured, so the modified query string doesn't appear in standard logs.
3. **Real-time logs capture headers** - Real-time logs can capture the `cs-headers` field with full headers (up to 800 bytes), allowing us to extract the `x-api-key` header for usage billing.

## Architecture

```
CloudFront Distribution
    ↓ (real-time logs with cs-headers field)
Kinesis Data Stream
    ↓
Kinesis Firehose
    ↓
S3 Bucket (compressed, partitioned by date)
    ↓
Athena / Glue Table (queryable)
```

## Resources Created

### 1. Kinesis Data Stream
- **Name**: `usage-billing-api-{stage}-realtime-logs`
- **Purpose**: Receives real-time log data from CloudFront
- **Configuration**: 1 shard, 24-hour retention

### 2. Kinesis Firehose
- **Name**: `usage-billing-api-{stage}-realtime-logs-firehose`
- **Purpose**: Delivers logs from Kinesis to S3
- **Buffering**: 5 MB or 5 minutes (whichever comes first)
- **Compression**: GZIP
- **Partitioning**: `year=YYYY/month=MM/day=DD/`

### 3. S3 Bucket
- **Name**: `usage-billing-api-{stage}-cloudfront-realtime-logs-{accountId}`
- **Purpose**: Storage for real-time logs
- **Lifecycle**: Logs expire after 90 days

### 4. CloudFront Real-time Log Config
- **Fields Captured**:
  - `timestamp` - Request timestamp
  - `c-ip` - Client IP address
  - `cs-method` - HTTP method (GET, POST, etc.)
  - `cs-uri-stem` - URI path
  - `cs-uri-query` - Query string parameters
  - **`cs-headers`** - Full request headers (includes x-api-key!)
  - `sc-status` - Response status code
  - `sc-bytes` - Response size
  - `x-edge-location` - CloudFront edge location
  - `x-edge-request-id` - Unique request ID
  - And more...
- **Sampling Rate**: 100% (all requests)

### 5. Glue Table
- **Name**: `cloudfront_realtime_logs`
- **Format**: JSON (logs are delivered as JSON)
- **Partitioning**: Automatic partition projection by year/month/day

## Querying Real-time Logs with Athena

### Example: Extract API keys from headers

```sql
SELECT
  FROM_UNIXTIME(timestamp/1000) as request_time,
  cs_method,
  cs_uri_stem,
  cs_uri_query,
  -- Extract x-api-key from cs_headers
  regexp_extract(cs_headers, '"x-api-key":"([^"]+)"', 1) as api_key,
  sc_status,
  sc_bytes
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
LIMIT 100;
```

### Example: Count requests by API key

```sql
SELECT
  regexp_extract(cs_headers, '"x-api-key":"([^"]+)"', 1) as api_key,
  COUNT(*) as request_count,
  SUM(sc_bytes) as total_bytes
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
GROUP BY regexp_extract(cs_headers, '"x-api-key":"([^"]+)"', 1)
ORDER BY request_count DESC;
```

### Example: Parse headers JSON

The `cs_headers` field contains headers as a JSON string. Example format:

```json
{
  "host": "d3o60fb1dwgq5k.cloudfront.net",
  "x-api-key": "abc123xyz",
  "user-agent": "curl/8.7.1",
  "accept": "*/*"
}
```

You can use Athena's JSON functions to parse this:

```sql
SELECT
  FROM_UNIXTIME(timestamp/1000) as request_time,
  json_extract_scalar(cs_headers, '$.x-api-key') as api_key,
  json_extract_scalar(cs_headers, '$.host') as host,
  json_extract_scalar(cs_headers, '$.user-agent') as user_agent
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05';
```

## IAM Permissions

The Lambda functions have been granted read access to the real-time logs S3 bucket and Kinesis stream for processing usage data.

## Comparison: Standard Logs vs Real-time Logs

| Feature | Standard Logs | Real-time Logs |
|---------|---------------|----------------|
| **Headers** | ❌ No | ✅ Yes (cs-headers) |
| **Latency** | Hours | Seconds |
| **Format** | TSV | JSON |
| **Cost** | Free | $0.01 per 1M log lines |
| **Retention** | Configurable | 24 hours in Kinesis, then S3 |
| **Query** | Athena | Athena, or real-time via Kinesis |

## Both Setups Are Active

Per the requirements, **both** standard CloudFront logs and real-time logs are active:

1. **Standard logs** - Continue to be written to `cloudfront-logs/` prefix in the `CloudFrontLogsBucket`
2. **Real-time logs** - Written to `realtime-logs/` prefix in the `RealtimeLogsBucket`

This allows you to:
- Use standard logs for historical analysis and cost-free long-term storage
- Use real-time logs for immediate processing and header extraction

## Cost Considerations

Real-time logs cost approximately:
- **$0.01 per 1 million log lines** delivered to Kinesis
- **Kinesis Data Stream**: ~$0.015 per shard-hour = ~$10.80/month for 1 shard
- **Kinesis Firehose**: $0.029 per GB ingested
- **S3 storage**: Standard S3 pricing

For low-traffic applications, this typically costs < $15/month.

## Next Steps

To process real-time logs for usage billing, you can:

1. **Create a Lambda function** that reads from the Kinesis stream to process logs in real-time
2. **Modify the rollup-usage handler** to query the `cloudfront_realtime_logs` table instead of (or in addition to) the standard logs
3. **Extract the x-api-key** from `cs_headers` using JSON parsing in Athena queries

## References

- [AWS CloudFront Real-time Logs Documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/real-time-logs.html)
- [Real-time Log Configuration Fields](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/real-time-logs.html#understand-real-time-log-config-fields)
