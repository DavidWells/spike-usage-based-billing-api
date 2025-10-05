# Athena Queries for Usage-Based Billing

This document provides SQL queries for extracting usage metrics by API key from CloudFront real-time logs stored in Parquet format.

## Understanding the cs_headers Field

The `cs_headers` field contains URL-encoded headers in the format:
```
Header1:value1%0AHeader2:value2%0AHeader3:value3%0A
```

Example from your logs:
```
User-Agent:vscode-restclient%0AX-Api-Key:pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx%0A...
```

Where `%0A` is the URL-encoded newline character (`\n`).

## Extract API Key from Headers

### Method 1: Using REGEXP_EXTRACT (Recommended)

```sql
SELECT
  FROM_UNIXTIME(timestamp/1000) as request_time,
  cs_method,
  cs_uri_stem,
  cs_uri_query,
  -- Extract x-api-key from URL-encoded headers
  url_decode(
    regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)
  ) as api_key,
  sc_status,
  sc_bytes,
  time_taken,
  c_country
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
  AND cs_headers LIKE '%X-Api-Key:%'
LIMIT 100
```

### Method 2: Using SPLIT and ARRAY Functions

```sql
SELECT
  FROM_UNIXTIME(timestamp/1000) as request_time,
  -- Extract API key by splitting headers
  element_at(
    split(
      element_at(
        filter(
          split(url_decode(cs_headers), chr(10)),
          x -> x LIKE 'X-Api-Key:%'
        ),
        1
      ),
      ':'
    ),
    2
  ) as api_key,
  cs_uri_stem,
  sc_bytes
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
LIMIT 100
```

## Usage-Based Billing Queries

### 1. Daily Usage by API Key

```sql
WITH api_key_logs AS (
  SELECT
    year,
    month,
    day,
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
    sc_bytes,
    cs_bytes,
    time_taken,
    sc_status,
    c_country,
    x_edge_result_type
  FROM cloudfront_realtime_logs
  WHERE year = '2025'
    AND month = '10'
    AND day = '05'
    AND cs_headers LIKE '%X-Api-Key:%'
)
SELECT
  CONCAT(year, '-', month, '-', day) as date,
  api_key,
  COUNT(*) as total_requests,
  SUM(sc_bytes) as total_bytes_sent,
  SUM(cs_bytes) as total_bytes_received,
  ROUND(AVG(time_taken), 3) as avg_response_time_ms,
  COUNT_IF(sc_status = 200) as successful_requests,
  COUNT_IF(sc_status >= 400) as error_requests,
  COUNT_IF(x_edge_result_type = 'Hit') as cache_hits,
  COUNT_IF(x_edge_result_type = 'Miss') as cache_misses
FROM api_key_logs
GROUP BY year, month, day, api_key
ORDER BY date, api_key
```

### 2. Request Count and Bandwidth by API Key (Current Month)

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  COUNT(*) as request_count,
  SUM(sc_bytes) as total_bytes_sent,
  SUM(cs_bytes) as total_bytes_received,
  ROUND(SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0, 4) as total_gb_sent,
  ROUND(AVG(time_taken), 2) as avg_response_time_ms,
  COUNT(DISTINCT c_country) as countries_served
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1))
ORDER BY request_count DESC
```

### 3. Geographic Distribution by API Key

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  c_country,
  COUNT(*) as request_count,
  SUM(sc_bytes) as total_bytes,
  ROUND(SUM(sc_bytes) / 1024.0 / 1024.0, 2) as total_mb
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
  c_country
ORDER BY api_key, request_count DESC
```

### 4. Endpoint Usage by API Key

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  cs_method,
  cs_uri_stem as endpoint,
  COUNT(*) as request_count,
  ROUND(AVG(time_taken), 2) as avg_response_time_ms,
  COUNT_IF(sc_status >= 400) as error_count
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
  cs_method,
  cs_uri_stem
ORDER BY api_key, request_count DESC
```

### 5. Cache Performance by API Key

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  x_edge_result_type,
  x_edge_detailed_result_type,
  COUNT(*) as request_count,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1))), 2) as percentage
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
  x_edge_result_type,
  x_edge_detailed_result_type
ORDER BY api_key, request_count DESC
```

### 6. Hourly Usage Pattern by API Key

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  DATE_FORMAT(FROM_UNIXTIME(timestamp/1000), '%Y-%m-%d %H:00:00') as hour,
  COUNT(*) as request_count,
  SUM(sc_bytes) as total_bytes,
  ROUND(AVG(time_taken), 2) as avg_response_time_ms
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
  DATE_FORMAT(FROM_UNIXTIME(timestamp/1000), '%Y-%m-%d %H:00:00')
ORDER BY hour, api_key
```

### 7. Content Type Distribution by API Key

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  sc_content_type,
  COUNT(*) as request_count,
  SUM(sc_bytes) as total_bytes,
  ROUND(SUM(sc_bytes) / 1024.0 / 1024.0, 2) as total_mb
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
  sc_content_type
ORDER BY api_key, request_count DESC
```

### 8. Error Analysis by API Key

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  sc_status,
  cs_uri_stem,
  COUNT(*) as error_count,
  ROUND(AVG(time_taken), 2) as avg_response_time_ms
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND sc_status >= 400
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
  sc_status,
  cs_uri_stem
ORDER BY error_count DESC
```

## Billing Calculation Queries

### 9. Calculate Billing (Requests + Bandwidth)

```sql
WITH usage_metrics AS (
  SELECT
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
    COUNT(*) as total_requests,
    SUM(sc_bytes) as total_bytes
  FROM cloudfront_realtime_logs
  WHERE year = '2025'
    AND month = '10'
    AND cs_headers LIKE '%X-Api-Key:%'
  GROUP BY url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1))
)
SELECT
  api_key,
  total_requests,
  total_bytes,
  ROUND(total_bytes / 1024.0 / 1024.0 / 1024.0, 4) as total_gb,
  -- Pricing examples (adjust to your rates)
  ROUND(total_requests * 0.0001, 2) as request_cost_usd,  -- $0.0001 per request
  ROUND((total_bytes / 1024.0 / 1024.0 / 1024.0) * 0.085, 2) as bandwidth_cost_usd,  -- $0.085 per GB
  ROUND((total_requests * 0.0001) + ((total_bytes / 1024.0 / 1024.0 / 1024.0) * 0.085), 2) as total_cost_usd
FROM usage_metrics
ORDER BY total_cost_usd DESC
```

### 10. Geographic-Based Pricing

```sql
WITH geo_pricing AS (
  SELECT
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
    c_country,
    COUNT(*) as requests,
    SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0 as gb_transferred,
    -- Different pricing by region
    CASE c_country
      WHEN 'US' THEN 0.085
      WHEN 'CA' THEN 0.085
      WHEN 'GB' THEN 0.090
      WHEN 'DE' THEN 0.090
      WHEN 'JP' THEN 0.100
      WHEN 'AU' THEN 0.110
      ELSE 0.120  -- Rest of world
    END as price_per_gb
  FROM cloudfront_realtime_logs
  WHERE year = '2025'
    AND month = '10'
    AND cs_headers LIKE '%X-Api-Key:%'
  GROUP BY
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
    c_country
)
SELECT
  api_key,
  c_country,
  requests,
  ROUND(gb_transferred, 4) as gb_transferred,
  price_per_gb,
  ROUND(gb_transferred * price_per_gb, 2) as cost_usd
FROM geo_pricing
ORDER BY api_key, cost_usd DESC
```

### 11. Cache Hit Discount Pricing

```sql
WITH cache_metrics AS (
  SELECT
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
    x_edge_result_type,
    COUNT(*) as requests,
    SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0 as gb_transferred,
    -- Lower price for cache hits
    CASE x_edge_result_type
      WHEN 'Hit' THEN 0.050  -- 40% discount for cache hits
      WHEN 'RefreshHit' THEN 0.050
      WHEN 'Miss' THEN 0.085
      WHEN 'Error' THEN 0.085
      ELSE 0.085
    END as price_per_gb
  FROM cloudfront_realtime_logs
  WHERE year = '2025'
    AND month = '10'
    AND cs_headers LIKE '%X-Api-Key:%'
  GROUP BY
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
    x_edge_result_type
)
SELECT
  api_key,
  SUM(requests) as total_requests,
  ROUND(SUM(gb_transferred), 4) as total_gb,
  ROUND(SUM(gb_transferred * price_per_gb), 2) as total_cost_usd,
  ROUND(SUM(CASE WHEN x_edge_result_type IN ('Hit', 'RefreshHit') THEN requests ELSE 0 END) * 100.0 / SUM(requests), 2) as cache_hit_rate
FROM cache_metrics
GROUP BY api_key
ORDER BY total_cost_usd DESC
```

## Advanced Queries

### 12. Time-Based Pricing (Peak vs Off-Peak)

```sql
WITH time_pricing AS (
  SELECT
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
    EXTRACT(HOUR FROM FROM_UNIXTIME(timestamp/1000)) as hour,
    COUNT(*) as requests,
    SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0 as gb_transferred,
    -- Peak hours (9am-5pm UTC) cost more
    CASE
      WHEN EXTRACT(HOUR FROM FROM_UNIXTIME(timestamp/1000)) BETWEEN 9 AND 17 THEN 0.100
      ELSE 0.070  -- Off-peak discount
    END as price_per_gb
  FROM cloudfront_realtime_logs
  WHERE year = '2025'
    AND month = '10'
    AND cs_headers LIKE '%X-Api-Key:%'
  GROUP BY
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
    EXTRACT(HOUR FROM FROM_UNIXTIME(timestamp/1000))
)
SELECT
  api_key,
  SUM(requests) as total_requests,
  ROUND(SUM(gb_transferred), 4) as total_gb,
  ROUND(SUM(gb_transferred * price_per_gb), 2) as total_cost_usd
FROM time_pricing
GROUP BY api_key
ORDER BY total_cost_usd DESC
```

### 13. Performance-Based Pricing

```sql
WITH performance_pricing AS (
  SELECT
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
    COUNT(*) as requests,
    SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0 as gb_transferred,
    AVG(time_taken) as avg_response_time,
    -- Faster responses cost less (incentivize optimization)
    CASE
      WHEN AVG(time_taken) < 100 THEN 0.070  -- Fast (<100ms)
      WHEN AVG(time_taken) < 500 THEN 0.085  -- Medium (100-500ms)
      ELSE 0.100  -- Slow (>500ms)
    END as price_per_gb
  FROM cloudfront_realtime_logs
  WHERE year = '2025'
    AND month = '10'
    AND cs_headers LIKE '%X-Api-Key:%'
  GROUP BY
    url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1))
)
SELECT
  api_key,
  requests,
  ROUND(gb_transferred, 4) as gb_transferred,
  ROUND(avg_response_time, 2) as avg_response_time_ms,
  price_per_gb,
  ROUND(gb_transferred * price_per_gb, 2) as cost_usd
FROM performance_pricing
ORDER BY cost_usd DESC
```

### 14. Monthly Usage Summary (Date Range)

```sql
SELECT
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
  CONCAT(year, '-', month) as month,
  COUNT(*) as total_requests,
  SUM(sc_bytes) as total_bytes,
  ROUND(SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0, 4) as total_gb,
  COUNT(DISTINCT CONCAT(year, '-', month, '-', day)) as days_active,
  COUNT(DISTINCT c_country) as countries,
  ROUND(AVG(time_taken), 2) as avg_response_time_ms
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month IN ('09', '10', '11')
  AND cs_headers LIKE '%X-Api-Key:%'
GROUP BY
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
  year,
  month
ORDER BY month, api_key
```

## Performance Optimization Tips

1. **Use Partition Projection**: The table is already configured with partition projection, so always specify `year`, `month`, and `day` in your WHERE clause to avoid full table scans

2. **Filter Early**: Always use `AND cs_headers LIKE '%X-Api-Key:%'` to filter only requests with API keys

3. **Columnar Benefits**: Parquet format means Athena only scans the columns you SELECT, so only request needed columns

4. **Cost Example**:
   - Query scanning 5 out of 43 columns on 100 GB Parquet data
   - Actual scan: ~12 GB (not 100 GB)
   - Cost: ~$0.06 per query (vs $0.50 for JSON)

5. **Common Table Expressions (CTEs)**: Use CTEs to extract the API key once and reuse it, improving readability

## Testing the Queries

Run this simple test query first to verify data is flowing:

```sql
SELECT
  FROM_UNIXTIME(timestamp/1000) as request_time,
  cs_uri_stem,
  url_decode(cs_headers) as headers_decoded,
  url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key
FROM cloudfront_realtime_logs
WHERE year = '2025'
  AND month = '10'
  AND day = '05'
LIMIT 10
```

## Next Steps

1. **Automate rollup**: Modify `src/handlers/rollup-usage.handler` to use these queries
2. **Create views**: Create Athena views for commonly used queries
3. **Set up alerts**: Monitor API key usage thresholds
4. **Export data**: Use these queries to export billing data to external systems
