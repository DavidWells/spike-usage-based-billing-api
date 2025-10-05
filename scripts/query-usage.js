#!/usr/bin/env node

/**
 * CLI tool to query usage data from CloudFront real-time logs
 *
 * Usage:
 *   node scripts/query-usage.js --date 2025-10-05
 *   node scripts/query-usage.js --date 2025-10-05 --api-key pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx
 *   node scripts/query-usage.js --date 2025-10-05 --billing
 *   node scripts/query-usage.js --date 2025-10-05 --cache-discount
 */

const {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand
} = require('@aws-sdk/client-athena')

const athena = new AthenaClient({ region: 'us-east-1' })

// Configuration - update these based on your stack outputs
const ATHENA_DATABASE = process.env.ATHENA_DATABASE || 'usage-billing-api_dev_usage_db'
const ATHENA_OUTPUT_BUCKET = process.env.ATHENA_OUTPUT_BUCKET || 's3://usage-billing-api-dev-athena-results-253490764618/'

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

    process.stdout.write('.')
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  throw new Error('Query timed out')
}

/**
 * Execute Athena query and return results
 */
async function executeAthenaQuery(query) {
  console.log('\n🔍 Executing Athena query...')

  const queryExecution = await athena.send(
    new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: ATHENA_DATABASE },
      ResultConfiguration: { OutputLocation: ATHENA_OUTPUT_BUCKET },
    })
  )

  const queryExecutionId = queryExecution.QueryExecutionId
  console.log(`📋 Query ID: ${queryExecutionId}`)

  const execution = await waitForQueryResults(queryExecutionId)

  // Log query stats
  const stats = execution.Statistics
  console.log('\n📊 Query Statistics:')
  console.log(`   Data Scanned: ${(stats.DataScannedInBytes / 1024 / 1024).toFixed(2)} MB`)
  console.log(`   Execution Time: ${stats.EngineExecutionTimeInMillis}ms`)
  console.log(`   Total Time: ${stats.TotalExecutionTimeInMillis}ms`)
  console.log(`   Estimated Cost: $${(stats.DataScannedInBytes / 1024 / 1024 / 1024 / 1024 * 5).toFixed(4)}`)

  const results = await athena.send(
    new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId })
  )

  return results.ResultSet.Rows
}

/**
 * Format results as table
 */
function formatTable(rows) {
  if (rows.length === 0) {
    console.log('No results found')
    return
  }

  // Extract headers
  const headers = rows[0].Data.map(d => d.VarCharValue)

  // Extract data rows
  const dataRows = rows.slice(1).map(row =>
    row.Data.map(d => d.VarCharValue || 'null')
  )

  // Calculate column widths
  const colWidths = headers.map((header, i) => {
    const dataWidth = Math.max(...dataRows.map(row => String(row[i]).length))
    return Math.max(header.length, dataWidth)
  })

  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ')
  console.log('\n' + headerRow)
  console.log(colWidths.map(w => '-'.repeat(w)).join('-+-'))

  // Print data rows
  dataRows.forEach(row => {
    const formattedRow = row.map((val, i) => String(val).padEnd(colWidths[i])).join(' | ')
    console.log(formattedRow)
  })

  console.log(`\n📈 Total rows: ${dataRows.length}`)
}

/**
 * Build daily usage query
 */
function buildDailyUsageQuery(year, month, day, apiKeyFilter = null) {
  const apiKeyCondition = apiKeyFilter
    ? `AND api_key = '${apiKeyFilter}'`
    : ''

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
        ${apiKeyCondition}
    )
    SELECT
      api_key,
      COUNT(*) as requests,
      ROUND(SUM(sc_bytes) / 1024.0 / 1024.0, 2) as mb_sent,
      ROUND(SUM(cs_bytes) / 1024.0 / 1024.0, 2) as mb_received,
      ROUND(AVG(time_taken), 2) as avg_ms,
      SUM(CASE WHEN sc_status = 200 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN sc_status >= 400 THEN 1 ELSE 0 END) as errors,
      SUM(CASE WHEN x_edge_result_type = 'Hit' THEN 1 ELSE 0 END) as cache_hits,
      SUM(CASE WHEN x_edge_result_type = 'Miss' THEN 1 ELSE 0 END) as cache_misses,
      COUNT(DISTINCT c_country) as countries
    FROM api_key_logs
    GROUP BY api_key
    ORDER BY requests DESC
  `
}

/**
 * Build billing query
 */
function buildBillingQuery(year, month, day) {
  return `
    WITH usage_metrics AS (
      SELECT
        url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
        COUNT(*) as total_requests,
        SUM(sc_bytes) as total_bytes
      FROM cloudfront_realtime_logs
      WHERE year = '${year}'
        AND month = '${month}'
        AND day = '${day}'
        AND cs_headers LIKE '%X-Api-Key:%'
      GROUP BY url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1))
    )
    SELECT
      api_key,
      total_requests,
      ROUND(total_bytes / 1024.0 / 1024.0 / 1024.0, 4) as total_gb,
      ROUND(total_requests * 0.0001, 4) as request_cost,
      ROUND((total_bytes / 1024.0 / 1024.0 / 1024.0) * 0.085, 4) as bandwidth_cost,
      ROUND((total_requests * 0.0001) + ((total_bytes / 1024.0 / 1024.0 / 1024.0) * 0.085), 4) as total_cost
    FROM usage_metrics
    ORDER BY total_cost DESC
  `
}

/**
 * Build cache discount query
 */
function buildCacheDiscountQuery(year, month, day) {
  return `
    WITH cache_metrics AS (
      SELECT
        url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)) as api_key,
        x_edge_result_type,
        COUNT(*) as requests,
        SUM(sc_bytes) / 1024.0 / 1024.0 / 1024.0 as gb_transferred,
        CASE x_edge_result_type
          WHEN 'Hit' THEN 0.050
          WHEN 'RefreshHit' THEN 0.050
          WHEN 'Miss' THEN 0.085
          ELSE 0.085
        END as price_per_gb
      FROM cloudfront_realtime_logs
      WHERE year = '${year}'
        AND month = '${month}'
        AND day = '${day}'
        AND cs_headers LIKE '%X-Api-Key:%'
      GROUP BY
        url_decode(regexp_extract(cs_headers, 'X-Api-Key:([^%]+)', 1)),
        x_edge_result_type
    )
    SELECT
      api_key,
      SUM(requests) as total_requests,
      ROUND(SUM(gb_transferred), 4) as total_gb,
      ROUND(SUM(gb_transferred * price_per_gb), 4) as total_cost,
      ROUND(SUM(CASE WHEN x_edge_result_type IN ('Hit', 'RefreshHit') THEN requests ELSE 0 END) * 100.0 / SUM(requests), 2) as cache_hit_rate
    FROM cache_metrics
    GROUP BY api_key
    ORDER BY total_cost DESC
  `
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)

  // Parse arguments
  let date = null
  let apiKey = null
  let queryType = 'daily_usage'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      date = args[i + 1]
      i++
    } else if (args[i] === '--api-key' && args[i + 1]) {
      apiKey = args[i + 1]
      i++
    } else if (args[i] === '--billing') {
      queryType = 'billing'
    } else if (args[i] === '--cache-discount') {
      queryType = 'cache_discount'
    }
  }

  // Default to yesterday if no date provided
  if (!date) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    date = yesterday.toISOString().split('T')[0]
  }

  const [year, month, day] = date.split('-')

  console.log('🚀 CloudFront Usage Query Tool')
  console.log('================================')
  console.log(`📅 Date: ${date}`)
  console.log(`🔑 API Key Filter: ${apiKey || 'All'}`)
  console.log(`📊 Query Type: ${queryType}`)

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
      query = buildDailyUsageQuery(year, month, day, apiKey)
      break
  }

  try {
    const rows = await executeAthenaQuery(query)
    formatTable(rows)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error)
}

module.exports = { executeAthenaQuery, buildDailyUsageQuery, buildBillingQuery, buildCacheDiscountQuery }
