# Usage Query Scripts

CLI tools for querying CloudFront real-time logs and calculating usage-based billing.

## Prerequisites

1. Deploy the CloudFront real-time logs infrastructure:
   ```bash
   serverless deploy
   ```

2. Configure environment variables:
   ```bash
   export ATHENA_DATABASE="usage_billing_api_dev_usage_db"
   export ATHENA_OUTPUT_BUCKET="s3://usage-billing-api-dev-athena-results-YOUR_ACCOUNT_ID/"
   ```

   Or get them from your stack outputs:
   ```bash
   serverless info --verbose
   ```

## request-tests.js

Generate test traffic to CloudFront endpoints with rotating API keys.

### Usage

```bash
# Make 5 requests (default) to each endpoint with rotating API keys
node scripts/request-tests.js

# Make 10 requests to each endpoint
node scripts/request-tests.js 10
```

### What it does

- Makes GET requests to `/example`
- Makes POST requests to `/data`
- Rotates through 3 API keys:
  - `apiKey1` (valid)
  - `apiKey2` (valid)
  - `fake-key-here` (invalid - for testing)
- Logs response status and body
- Waits 500ms between requests to avoid throttling

### Example output

```
🚀 CloudFront API Request Test Script
=====================================
Base URL: https://d3o60fb1dwgq5k.cloudfront.net
Number of requests per endpoint: 5
API Keys: 3 (2 valid, 1 fake)

--- Request 1/5 ---

🔵 GET /example with apiKey1
   Status: 200
   Body: {"message":"Example endpoint response","timestamp":"..."}

🟢 POST /data with apiKey1
   Status: 200
   Body: {"message":"Data received successfully","timestamp":"..."}
```

**Note:** Wait 5 minutes after running for Firehose to flush data to S3.

## query-basic-logs.js

Query CloudFront standard access logs for basic usage metrics by path.

### Usage

```bash
# Query logs for specific date (all paths)
node scripts/query-basic-logs.js --date 2025-10-05

# Query logs for specific path
node scripts/query-basic-logs.js --date 2025-10-05 --path /example

# Defaults to yesterday if no date specified
node scripts/query-basic-logs.js
```

### Output

Shows usage metrics grouped by path (`cs-uri-stem`):
- Request count
- Bandwidth (MB sent/received)
- Average response time (ms)
- Success/error counts
- Cache hit/miss counts
- Unique IP addresses
- HTTP methods used

Example output:
```
path     | requests | mb_sent | mb_received | avg_ms | success | errors | cache_hits | cache_misses | unique_ips | methods
/example | 250      | 5.23    | 1.45        | 142.5  | 240     | 10     | 150        | 100          | 45         | GET, POST
/data    | 180      | 3.12    | 2.15        | 98.3   | 175     | 5      | 120        | 60           | 32         | POST
```

**Note:** CloudFront standard access logs have a delay of up to 24 hours. For near real-time data, use `query-usage.js` which queries the real-time logs.

## query-usage.js

Query CloudFront real-time logs for usage metrics by API key.

### Usage

```bash
# Query usage for specific date (all API keys)
node scripts/query-usage.js --date 2025-10-05

# Query usage for specific API key
node scripts/query-usage.js --date 2025-10-05 --api-key pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx

# Calculate billing with geographic pricing
node scripts/query-usage.js --date 2025-10-05 --billing

# Calculate billing with cache hit discounts (40% discount for cache hits)
node scripts/query-usage.js --date 2025-10-05 --cache-discount

# Defaults to yesterday if no date specified
node scripts/query-usage.js
```

### Query Types

#### Daily Usage (`default`)

Shows comprehensive usage metrics per API key:
- Request count
- Bandwidth (MB sent/received)
- Average response time
- Success/error counts
- Cache hit/miss counts
- Countries served

Example output:
```
api_key                                  | requests | mb_sent | mb_received | avg_ms | success | errors | cache_hits | cache_misses | countries
pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx | 1250     | 45.23   | 12.45       | 142.5  | 1200    | 50     | 800        | 450          | 5
```

#### Billing (`--billing`)

Calculates costs with geographic pricing:
- $0.0001 per request
- Variable bandwidth pricing by country:
  - US/CA: $0.085 per GB
  - GB/DE: $0.090 per GB
  - JP: $0.100 per GB
  - AU: $0.110 per GB
  - Rest of world: $0.120 per GB

Example output:
```
api_key                                  | total_requests | total_gb | request_cost | bandwidth_cost | total_cost
pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx | 1250          | 0.0452   | 0.1250       | 0.0038         | 0.1288
```

#### Cache Discount (`--cache-discount`)

Applies discounted pricing for cache hits:
- Cache hits/RefreshHits: $0.050 per GB (40% discount)
- Cache misses/errors: $0.085 per GB (standard rate)

Example output:
```
api_key                                  | total_requests | total_gb | total_cost | cache_hit_rate
pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx | 1250          | 0.0452   | 0.0023     | 64.00
```

### Query Statistics

The tool displays Athena query statistics:
```
📊 Query Statistics:
   Data Scanned: 12.45 MB
   Execution Time: 1523ms
   Total Time: 1850ms
   Estimated Cost: $0.0001
```

**Note:** Parquet format reduces data scanned by 70-90% compared to JSON, significantly lowering Athena costs.

## Direct Athena Queries

You can also run queries directly in the AWS Athena console. See `/docs/ATHENA_QUERIES.md` for comprehensive examples.

### Quick Test Query

```sql
SELECT
  FROM_UNIXTIME(timestamp/1000) as request_time,
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  cs_uri_stem,
  sc_status,
  sc_bytes
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
  AND cs_headers LIKE '%X-Api-Key:%'
LIMIT 10
```

## Troubleshooting

### "No results found"

Check that:
1. Real-time logs are flowing to Kinesis/Firehose
2. The date partition exists in S3
3. The API key header is being sent in requests

### "Query failed: HIVE_PARTITION_SCHEMA_MISMATCH"

The Glue table schema might be out of sync. Run:
```sql
MSCK REPAIR TABLE cloudfront_realtime_logs
```

### "Access Denied" errors

Ensure your AWS credentials have:
- `athena:StartQueryExecution`
- `athena:GetQueryExecution`
- `athena:GetQueryResults`
- `s3:GetObject` on the logs bucket
- `s3:PutObject` on the Athena results bucket
- `glue:GetTable` on the Glue database

## Cost Optimization

1. **Always specify date partitions** - Use `WHERE year = 'X' AND month = 'Y' AND day = 'Z'` to avoid full table scans

2. **Select only needed columns** - Parquet format only scans requested columns

3. **Use partition projection** - Already configured in the Glue table for automatic partition discovery

4. **Aggregate at query time** - Use CTEs and GROUP BY rather than scanning all rows multiple times

Example cost for 100 GB of Parquet logs:
- Query scanning 5 columns: ~12 GB scanned = $0.06
- Same query on JSON: 100 GB scanned = $0.50
- **Savings: 88%**
