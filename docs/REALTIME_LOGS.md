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
- **Buffering**: 128 MB or 5 minutes (whichever comes first)
- **Format**: Parquet with SNAPPY compression
- **Partitioning**: `year=YYYY/month=MM/day=DD/`

### 3. S3 Bucket
- **Name**: `usage-billing-api-{stage}-cloudfront-realtime-logs-{accountId}`
- **Purpose**: Storage for real-time logs
- **Lifecycle**: Logs expire after 90 days

### 4. CloudFront Real-time Log Config
- **Fields Captured** (43 fields total for comprehensive usage-based billing):
  - **Timing & Identity**:
    - `timestamp` - Request timestamp
    - `c-ip` - Client IP address
    - `s-ip` - CloudFront server IP
    - `c-ip-version` - IPv4 or IPv6
    - `c-country` - Client country code (geo-based pricing)
    - `asn` - Autonomous system number
  - **Request Details**:
    - `cs-method` - HTTP method (GET, POST, etc.)
    - `cs-protocol` - Protocol (http, https, ws, wss, grpcs)
    - `cs-protocol-version` - HTTP version
    - `cs-host` - Domain name (per-tenant billing)
    - `cs-uri-stem` - URI path
    - `cs-uri-query` - Query string parameters
  - **Headers & Content**:
    - **`cs-headers`** - Full request headers (includes x-api-key!)
    - `cs-header-names` - Header names only
    - `cs-headers-count` - Number of headers
    - `cs-user-agent` - User agent string
    - `cs-referer` - Referrer header
    - `cs-cookie` - Cookie header
    - `cs-accept` - Accept header
    - `cs-accept-encoding` - Accept-Encoding header
  - **Response & Content**:
    - `sc-status` - Response status code
    - `sc-bytes` - Response size (bandwidth billing)
    - `cs-bytes` - Request size
    - `sc-content-type` - Content type (content-based pricing)
    - `sc-content-len` - Content length
    - `sc-range-start` - Range request start
    - `sc-range-end` - Range request end
  - **Performance**:
    - `time-to-first-byte` - Processing latency
    - `time-taken` - Total request duration
    - `origin-fbl` - Origin first-byte latency
    - `origin-lbl` - Origin last-byte latency
  - **CloudFront Metadata**:
    - `x-edge-location` - Edge location
    - `x-edge-request-id` - Unique request ID
    - `x-host-header` - CloudFront domain
    - `x-edge-result-type` - Cache hit/miss (discount cache hits)
    - `x-edge-response-result-type` - Response result type
    - `x-edge-detailed-result-type` - Detailed result (Origin Shield tracking)
    - `cache-behavior-path-pattern` - Cache behavior matched
  - **Security & SSL**:
    - `ssl-protocol` - SSL/TLS protocol
    - `ssl-cipher` - SSL/TLS cipher
    - `x-forwarded-for` - Original IP if proxied
    - `c-port` - Client port
    - `fle-status` - Field-level encryption status
    - `fle-encrypted-fields` - Number of encrypted fields
- **Sampling Rate**: 100% (all requests)

### 5. Glue Table
- **Name**: `cloudfront_realtime_logs`
- **Format**: Parquet (columnar format for efficient querying)
- **Compression**: SNAPPY
- **Partitioning**: Automatic partition projection by year/month/day
- **Cost Efficiency**: Parquet format reduces Athena query costs by 70-90% compared to JSON

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

## Parquet Format Benefits

The real-time logs are converted from JSON to Parquet format for significant cost and performance improvements:

- **70-90% lower Athena query costs** - Columnar storage means Athena only scans columns you query
- **3-5x better compression** - Parquet with SNAPPY compression is much more efficient than GZIP JSON
- **5-10x faster queries** - Columnar format optimized for analytical queries
- **Schema enforcement** - Parquet validates data types, reducing query errors

**Cost Example:**
- 100 GB of logs in JSON/GZIP → 20-30 GB in Parquet
- Query scanning 10 out of 43 columns:
  - JSON: scans 100 GB = $0.50
  - Parquet: scans ~15 GB = $0.075
  - **85% cost reduction per query**

## Comparison: Standard Logs vs Real-time Logs

| Feature | Standard Logs | Real-time Logs |
|---------|---------------|----------------|
| **Headers** | ❌ No | ✅ Yes (cs-headers) |
| **Latency** | Hours | Seconds |
| **Format** | TSV | Parquet (columnar) |
| **Fields** | 29 fields | 43 fields (comprehensive billing data) |
| **Cost** | Free | $0.01 per 1M log lines |
| **Retention** | Configurable | 24 hours in Kinesis, then S3 |
| **Query** | Athena | Athena, or real-time via Kinesis |
| **Query Cost** | $5/TB scanned | $5/TB scanned (but 70-90% less data with Parquet) |

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
- **S3 storage**: Reduced by 70-80% due to Parquet compression
- **Athena queries**: 70-90% lower cost due to columnar Parquet format

For low-traffic applications, this typically costs < $15/month for ingestion, with significantly reduced query costs compared to JSON logs.

## Next Steps

To process real-time logs for usage billing, you can:

1. **Create a Lambda function** that reads from the Kinesis stream to process logs in real-time
2. **Modify the rollup-usage handler** to query the `cloudfront_realtime_logs` table instead of (or in addition to) the standard logs
3. **Extract the x-api-key** from `cs_headers` using JSON parsing in Athena queries

## References

- [AWS CloudFront Real-time Logs Documentation](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/real-time-logs.html)
- [Real-time Log Configuration Fields](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/real-time-logs.html#understand-real-time-log-config-fields)
