/**
 * Real-time logs rollup Lambda function
 * Queries CloudFront real-time logs (Parquet) via Athena and stores aggregated usage in DynamoDB
 * Extracts API key from cs_headers field
 */

const {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand
} = require('@aws-sdk/client-athena')
const {
  DynamoDBClient,
  UpdateItemCommand,
  PutItemCommand
} = require('@aws-sdk/client-dynamodb')

const athena = new AthenaClient()
const dynamodb = new DynamoDBClient()

const ATHENA_DATABASE = process.env.ATHENA_DATABASE
const ATHENA_OUTPUT_BUCKET = process.env.ATHENA_OUTPUT_BUCKET
const USAGE_METRICS_TABLE = process.env.USAGE_METRICS_TABLE

/**
 * Wait for Athena query to complete
 */
async function waitForQueryResults(queryExecutionId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await athena.send(
      new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId })
    )

    const state = response.QueryExecution.Status.State

    if (state === 'SUCCEEDED') {
      return response.QueryExecution
    } else if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(
        `Query failed: ${response.QueryExecution.Status.StateChangeReason}`
      )
    }

    // Wait 2 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error('Query timed out')
}

/**
 * Execute Athena query and return results
 */
async function executeAthenaQuery(query) {
  console.log('Executing Athena query:', query)

  const queryExecution = await athena.send(
    new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: ATHENA_DATABASE },
      ResultConfiguration: { OutputLocation: ATHENA_OUTPUT_BUCKET },
    })
  )

  const queryExecutionId = queryExecution.QueryExecutionId
  console.log('Query execution ID:', queryExecutionId)

  const execution = await waitForQueryResults(queryExecutionId)

  // Log query stats
  const stats = execution.Statistics
  console.log('Query stats:', {
    dataScannedInBytes: stats.DataScannedInBytes,
    dataScannedInMB: (stats.DataScannedInBytes / 1024 / 1024).toFixed(2),
    executionTimeInMs: stats.EngineExecutionTimeInMillis,
    totalTimeInMs: stats.TotalExecutionTimeInMillis
  })

  const results = await athena.send(
    new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId })
  )

  return results.ResultSet.Rows
}

/**
 * Store detailed usage data in DynamoDB
 */
async function storeUsageMetrics(apiKey, timestamp, metrics) {
  console.log('Storing metrics for', apiKey, timestamp, metrics)

  await dynamodb.send(
    new PutItemCommand({
      TableName: USAGE_METRICS_TABLE,
      Item: {
        api_key: { S: apiKey },
        date: { S: timestamp },
        request_count: { N: metrics.request_count.toString() },
        total_bytes_sent: { N: metrics.total_bytes_sent.toString() },
        total_bytes_received: { N: metrics.total_bytes_received.toString() },
        avg_response_time_ms: { N: metrics.avg_response_time_ms.toString() },
        successful_requests: { N: metrics.successful_requests.toString() },
        error_requests: { N: metrics.error_requests.toString() },
        cache_hits: { N: metrics.cache_hits.toString() },
        cache_misses: { N: metrics.cache_misses.toString() },
        countries_served: { N: metrics.countries_served.toString() },
        last_updated: { S: new Date().toISOString() },
      },
    })
  )
}

/**
 * Daily usage rollup query
 */
function buildDailyUsageQuery(year, month, day) {
  return `
    WITH api_key_logs AS (
      SELECT
        api_key,
        sc_bytes,
        cs_bytes,
        time_taken,
        sc_status,
        c_country,
        x_edge_result_type
      FROM cloudfront_realtime_logs
      WHERE year = '${year}'
        AND month = '${month}'
        AND day = '${day}'
        AND api_key IS NOT NULL
    )
    SELECT
      api_key,
      COUNT(*) as total_requests,
      SUM(sc_bytes) as total_bytes_sent,
      SUM(cs_bytes) as total_bytes_received,
      ROUND(AVG(time_taken), 3) as avg_response_time_ms,
      SUM(CASE WHEN sc_status = 200 THEN 1 ELSE 0 END) as successful_requests,
      SUM(CASE WHEN sc_status >= 400 THEN 1 ELSE 0 END) as error_requests,
      SUM(CASE WHEN x_edge_result_type = 'Hit' THEN 1 ELSE 0 END) as cache_hits,
      SUM(CASE WHEN x_edge_result_type = 'Miss' THEN 1 ELSE 0 END) as cache_misses,
      COUNT(DISTINCT c_country) as countries_served
    FROM api_key_logs
    GROUP BY api_key
  `
}

/**
 * Billing calculation query with geographic pricing
 */
function buildBillingQuery(year, month, day) {
  return `
    WITH geo_usage AS (
      SELECT
        api_key,
        c_country,
        COUNT(*) as requests,
        SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0 as gb_transferred,
        CASE c_country
          WHEN 'US' THEN 0.085
          WHEN 'CA' THEN 0.085
          WHEN 'GB' THEN 0.090
          WHEN 'DE' THEN 0.090
          WHEN 'JP' THEN 0.100
          WHEN 'AU' THEN 0.110
          ELSE 0.120
        END as price_per_gb
      FROM cloudfront_realtime_logs
      WHERE year = '${year}'
        AND month = '${month}'
        AND day = '${day}'
        AND api_key IS NOT NULL
      GROUP BY
        api_key,
        c_country
    )
    SELECT
      api_key,
      SUM(requests) as total_requests,
      ROUND(SUM(gb_transferred), 4) as total_gb,
      ROUND(SUM(requests) * 0.0001, 4) as request_cost_usd,
      ROUND(SUM(gb_transferred * price_per_gb), 4) as bandwidth_cost_usd,
      ROUND((SUM(requests) * 0.0001) + SUM(gb_transferred * price_per_gb), 4) as total_cost_usd
    FROM geo_usage
    GROUP BY api_key
    ORDER BY total_cost_usd DESC
  `
}

/**
 * Cache-based discount pricing query
 */
function buildCacheDiscountQuery(year, month, day) {
  return `
    WITH cache_metrics AS (
      SELECT
        api_key,
        x_edge_result_type,
        COUNT(*) as requests,
        SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0 as gb_transferred,
        CASE x_edge_result_type
          WHEN 'Hit' THEN 0.050
          WHEN 'RefreshHit' THEN 0.050
          WHEN 'Miss' THEN 0.085
          WHEN 'Error' THEN 0.085
          ELSE 0.085
        END as price_per_gb
      FROM cloudfront_realtime_logs
      WHERE year = '${year}'
        AND month = '${month}'
        AND day = '${day}'
        AND api_key IS NOT NULL
      GROUP BY
        api_key,
        x_edge_result_type
    )
    SELECT
      api_key,
      SUM(requests) as total_requests,
      ROUND(SUM(gb_transferred), 4) as total_gb,
      ROUND(SUM(gb_transferred * price_per_gb), 4) as total_cost_usd,
      ROUND(SUM(CASE WHEN x_edge_result_type IN ('Hit', 'RefreshHit') THEN requests ELSE 0 END) * 100.0 / SUM(requests), 2) as cache_hit_rate
    FROM cache_metrics
    GROUP BY api_key
    ORDER BY total_cost_usd DESC
  `
}

/**
 * Parse date components
 */
function parseDateComponents(dateStr) {
  const [year, month, day] = dateStr.split('-')
  return { year, month, day }
}

/**
 * Main handler function
 */
module.exports.handler = async (event) => {
  console.log('Rollup event:', JSON.stringify(event, null, 2))

  try {
    // Calculate date to process (yesterday by default)
    const targetDate = event.date || getYesterdayDate()
    const { year, month, day } = parseDateComponents(targetDate)

    // Create ISO 8601 timestamp for DynamoDB (daily rollup at midnight UTC)
    const timestamp = `${targetDate}T00:00:00Z`

    console.log('Processing date:', targetDate, { year, month, day, timestamp })

    // Choose query type based on event parameter
    const queryType = event.queryType || 'daily_usage'
    let query

    switch (queryType) {
      case 'billing':
        query = buildBillingQuery(year, month, day)
        break
      case 'cache_discount':
        query = buildCacheDiscountQuery(year, month, day)
        break
      case 'daily_usage':
      default:
        query = buildDailyUsageQuery(year, month, day)
        break
    }

    console.log('Query type:', queryType)
    const rows = await executeAthenaQuery(query)

    // Skip header row
    const dataRows = rows.slice(1)

    console.log(`Found ${dataRows.length} API keys with usage`)

    // Store results in DynamoDB (for daily_usage query type)
    if (queryType === 'daily_usage') {
      for (const row of dataRows) {
        const data = row.Data.map(d => d.VarCharValue)
        const [
          apiKey,
          requestCount,
          totalBytesSent,
          totalBytesReceived,
          avgResponseTime,
          successfulRequests,
          errorRequests,
          cacheHits,
          cacheMisses,
          countriesServed
        ] = data

        await storeUsageMetrics(apiKey, timestamp, {
          request_count: parseInt(requestCount, 10) || 0,
          total_bytes_sent: parseInt(totalBytesSent, 10) || 0,
          total_bytes_received: parseInt(totalBytesReceived, 10) || 0,
          avg_response_time_ms: parseFloat(avgResponseTime) || 0,
          successful_requests: parseInt(successfulRequests, 10) || 0,
          error_requests: parseInt(errorRequests, 10) || 0,
          cache_hits: parseInt(cacheHits, 10) || 0,
          cache_misses: parseInt(cacheMisses, 10) || 0,
          countries_served: parseInt(countriesServed, 10) || 0
        })
      }
    }

    // Return results
    const results = dataRows.map(row => {
      const data = row.Data.map(d => d.VarCharValue)
      return data
    })

    console.log('Rollup completed successfully')

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Usage rollup completed',
        date: targetDate,
        timestamp,
        queryType,
        apiKeysProcessed: dataRows.length,
        results: results.length <= 10 ? results : results.slice(0, 10) // Limit to first 10 for response
      }),
    }
  } catch (error) {
    console.error('Rollup failed:', error)
    throw error
  }
}

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
function getYesterdayDate() {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return yesterday.toISOString().split('T')[0]
}
