# Quick Start Guide

Get up and running with usage-based billing in 5 minutes.

## 1. Deploy the Stack

```bash
npm install
npm run deploy
```

Save the outputs - you'll need:
- `CloudFrontDomainName` - For making requests
- `ApiKeyId1` and `ApiKeyId2` - For getting API key values

## 2. Get Your API Keys

```bash
# Get all API keys with values
aws apigateway get-api-keys --include-values --region us-east-1

# Or get specific key
aws apigateway get-api-key --api-key YOUR_KEY_ID --include-value --region us-east-1
```

Copy one of the API key values (e.g., `pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx`)

## 3. Make Test Requests

Replace `YOUR_CLOUDFRONT_DOMAIN` and `YOUR_API_KEY`:

```bash
# GET request
curl -X GET https://YOUR_CLOUDFRONT_DOMAIN/example \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Accept: application/json"

# POST request
curl -X POST https://YOUR_CLOUDFRONT_DOMAIN/data \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"test": "data", "amount": 123}'

# Make multiple requests to generate usage data
for i in {1..10}; do
  curl -X GET https://YOUR_CLOUDFRONT_DOMAIN/example \
    -H "x-api-key: YOUR_API_KEY"
  sleep 1
done
```

## 4. Wait for Logs (30-60 seconds)

Real-time logs are delivered within 30 seconds:
- CloudFront → Kinesis Data Stream → Kinesis Firehose → S3 (Parquet)

Check the S3 bucket:
```bash
aws s3 ls s3://usage-billing-api-dev-cloudfront-realtime-logs-YOUR_ACCOUNT_ID/realtime-logs/ --recursive
```

## 5. Query Usage Data

### Option A: CLI Tool (Recommended)

```bash
# Configure environment (get values from serverless outputs)
export ATHENA_DATABASE="usage_billing_api_dev_usage_db"
export ATHENA_OUTPUT_BUCKET="s3://usage-billing-api-dev-athena-results-YOUR_ACCOUNT_ID/"

# Query today's usage
node scripts/query-usage.js --date $(date +%Y-%m-%d)

# Query specific API key
node scripts/query-usage.js --date $(date +%Y-%m-%d) --api-key YOUR_API_KEY

# Calculate billing
node scripts/query-usage.js --date $(date +%Y-%m-%d) --billing
```

### Option B: AWS Athena Console

1. Go to **AWS Athena Console**
2. Select database: `usage_billing_api_dev_usage_db`
3. Run this query (update the date):

```sql
SELECT
  FROM_UNIXTIME(timestamp/1000) as request_time,
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  cs_method,
  cs_uri_stem,
  sc_status,
  sc_bytes,
  time_taken,
  c_country
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
  AND cs_headers LIKE '%X-Api-Key:%'
ORDER BY timestamp DESC
LIMIT 20
```

## 6. Aggregate Usage by API Key

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  COUNT(*) as total_requests,
  ROUND(SUM(sc_bytes) / 1024.0 / 1024.0, 2) as total_mb,
  ROUND(AVG(time_taken), 2) as avg_response_time_ms,
  COUNT_IF(sc_status = 200) as successful_requests,
  COUNT_IF(sc_status >= 400) as error_requests,
  COUNT(DISTINCT c_country) as countries_served
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1))
ORDER BY total_requests DESC
```

## Expected Results

After running 10 test requests, you should see:

**CLI Output:**
```
🔍 Executing Athena query...
📋 Query ID: 12345678-1234-1234-1234-123456789012
..
📊 Query Statistics:
   Data Scanned: 0.15 MB
   Execution Time: 1234ms
   Total Time: 1567ms
   Estimated Cost: $0.0001

api_key                                  | requests | mb_sent | mb_received | avg_ms | success | errors | cache_hits | cache_misses | countries
YOUR_API_KEY                             | 10       | 0.01    | 0.00        | 145.32 | 10      | 0      | 0          | 10           | 1

📈 Total rows: 1
```

**Athena Console:**
```
request_time              | api_key      | cs_method | cs_uri_stem | sc_status | sc_bytes | time_taken | c_country
2025-10-05 02:15:23.456  | YOUR_API_KEY | GET       | /example    | 200       | 783      | 142.5      | US
2025-10-05 02:15:22.123  | YOUR_API_KEY | GET       | /example    | 200       | 783      | 138.2      | US
...
```

## Troubleshooting

### No results in Athena?

1. **Check logs are being delivered:**
   ```bash
   aws s3 ls s3://usage-billing-api-dev-cloudfront-realtime-logs-YOUR_ACCOUNT_ID/realtime-logs/ --recursive
   ```

2. **Verify Kinesis stream is receiving data:**
   ```bash
   aws kinesis describe-stream-summary --stream-name usage-billing-api-dev-realtime-logs --region us-east-1
   ```

3. **Check Firehose delivery:**
   ```bash
   aws firehose describe-delivery-stream --delivery-stream-name usage-billing-api-dev-realtime-logs-firehose --region us-east-1
   ```

4. **Verify date partition exists:**
   ```bash
   aws s3 ls s3://usage-billing-api-dev-cloudfront-realtime-logs-YOUR_ACCOUNT_ID/realtime-logs/year=2025/month=10/day=05/
   ```

### Wrong date partition?

Update the query with the correct year/month/day:
```sql
WHERE year = '2025'
  AND month = '10'  -- Note: Must be 2-digit with leading zero
  AND day = '05'    -- Note: Must be 2-digit with leading zero
```

### API key not showing up?

Check that:
1. You're sending the `X-Api-Key` header (case-insensitive in CloudFront)
2. Using the CloudFront URL, not API Gateway URL directly
3. The `cs_headers` field contains the API key:

```sql
SELECT
  url_decode(cs_headers) as headers
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
LIMIT 1
```

Look for `X-Api-Key:YOUR_KEY` in the output.

## Next Steps

- **[ATHENA_QUERIES.md](./ATHENA_QUERIES.md)** - 14 query examples (billing, geographic pricing, cache discounts, etc.)
- **[REALTIME_LOGS.md](./REALTIME_LOGS.md)** - Architecture and field reference
- **[scripts/README.md](../scripts/README.md)** - CLI tool documentation
- **[../NOTES.md](../NOTES.md)** - Implementation notes and learnings

## Billing Calculation Example

With the cache discount pricing model:

```bash
node scripts/query-usage.js --date 2025-10-05 --cache-discount
```

Result:
```
api_key      | total_requests | total_gb | total_cost | cache_hit_rate
YOUR_API_KEY | 10000         | 1.2500   | 0.0625     | 0.00

Cost breakdown:
- 10,000 requests × $0.0001 = $1.00 (not shown in this query)
- 1.25 GB × $0.085 (all cache misses) = $0.106
- With 64% cache hit rate: 0.8 GB × $0.050 + 0.45 GB × $0.085 = $0.078
- Total savings: $0.028 (26% reduction)
```

## Cost Expectations

For 1 million requests/day:
- **Real-time log ingestion**: $10/month (Kinesis)
- **Firehose delivery**: $29/month
- **S3 storage**: $5/month (with Parquet compression)
- **Athena queries**: $1-5/month (daily rollups)
- **Total infrastructure**: ~$45-50/month

Parquet format reduces Athena costs by 70-90% vs JSON.
