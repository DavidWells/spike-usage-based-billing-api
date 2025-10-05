#!/usr/bin/env node
// ABOUTME: Query CloudFront standard access logs for basic usage metrics by path
// ABOUTME: Uses Athena to query the cloudfront_logs Glue table

const {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand
} = require('@aws-sdk/client-athena')

const athena = new AthenaClient({ region: 'us-east-1' })

// Configuration
const ATHENA_DATABASE = process.env.ATHENA_DATABASE || 'usage-billing-api_dev_usage_db'
const ATHENA_OUTPUT_BUCKET = process.env.ATHENA_OUTPUT_BUCKET || 's3://usage-billing-api-dev-athena-results-253490764618/'

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  const options = {
    date: null,
    path: null
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      options.date = args[i + 1]
      i++
    } else if (args[i] === '--path' && args[i + 1]) {
      options.path = args[i + 1]
      i++
    }
  }

  // Default to yesterday if no date specified
  if (!options.date) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    options.date = yesterday.toISOString().split('T')[0]
  }

  return options
}

/**
 * Build query for path-based usage
 */
function buildPathUsageQuery(year, month, day, pathFilter = null) {
  const pathCondition = pathFilter
    ? `AND cs_uri_stem = '${pathFilter}'`
    : ''

  return `
    SELECT
      cs_uri_stem as path,
      COUNT(*) as requests,
      ROUND(SUM(sc_bytes) / 1024.0 / 1024.0, 2) as mb_sent,
      ROUND(SUM(cs_bytes) / 1024.0 / 1024.0, 2) as mb_received,
      ROUND(AVG(time_taken) * 1000, 2) as avg_ms,
      SUM(CASE WHEN sc_status >= 200 AND sc_status < 400 THEN 1 ELSE 0 END) as success,
      SUM(CASE WHEN sc_status >= 400 THEN 1 ELSE 0 END) as errors,
      SUM(CASE WHEN x_edge_result_type IN ('Hit', 'RefreshHit') THEN 1 ELSE 0 END) as cache_hits,
      SUM(CASE WHEN x_edge_result_type IN ('Miss', 'Error') THEN 1 ELSE 0 END) as cache_misses,
      COUNT(DISTINCT c_ip) as unique_ips,
      array_join(array_agg(DISTINCT cs_method), ', ') as methods
    FROM cloudfront_logs
    WHERE date = DATE '${year}-${month}-${day}'
      ${pathCondition}
    GROUP BY cs_uri_stem
    ORDER BY requests DESC
  `
}

/**
 * Execute Athena query
 */
async function executeQuery(query) {
  const startTime = Date.now()

  // Start query execution
  const startCommand = new StartQueryExecutionCommand({
    QueryString: query,
    QueryExecutionContext: {
      Database: ATHENA_DATABASE
    },
    ResultConfiguration: {
      OutputLocation: ATHENA_OUTPUT_BUCKET
    }
  })

  const startResponse = await athena.send(startCommand)
  const queryExecutionId = startResponse.QueryExecutionId

  console.log(`📋 Query ID: ${queryExecutionId}`)

  // Wait for query to complete
  let status = 'RUNNING'
  let executionDetails = null

  while (status === 'RUNNING' || status === 'QUEUED') {
    await new Promise(resolve => setTimeout(resolve, 200))
    process.stdout.write('.')

    const getCommand = new GetQueryExecutionCommand({
      QueryExecutionId: queryExecutionId
    })

    const getResponse = await athena.send(getCommand)
    executionDetails = getResponse.QueryExecution
    status = executionDetails.Status.State
  }

  console.log('') // New line after dots

  if (status !== 'SUCCEEDED') {
    throw new Error(`Query failed with status: ${status}\nReason: ${executionDetails.Status.StateChangeReason}`)
  }

  const totalTime = Date.now() - startTime

  // Get query results
  const resultsCommand = new GetQueryResultsCommand({
    QueryExecutionId: queryExecutionId
  })

  const resultsResponse = await athena.send(resultsCommand)

  // Display query statistics
  const stats = executionDetails.Statistics
  console.log('\n📊 Query Statistics:')
  console.log(`   Data Scanned: ${(stats.DataScannedInBytes / 1024 / 1024).toFixed(2)} MB`)
  console.log(`   Execution Time: ${stats.EngineExecutionTimeInMillis}ms`)
  console.log(`   Total Time: ${totalTime}ms`)
  console.log(`   Estimated Cost: $${(stats.DataScannedInBytes / 1024 / 1024 / 1024 / 1024 * 5).toFixed(4)}`)

  return resultsResponse.ResultSet
}

/**
 * Format and display results as table
 */
function displayResults(resultSet) {
  if (!resultSet.Rows || resultSet.Rows.length <= 1) {
    console.log('\n⚠️  No results found')
    return
  }

  // Extract headers and data
  const headers = resultSet.Rows[0].Data.map(d => d.VarCharValue)
  const dataRows = resultSet.Rows.slice(1).map(row =>
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

  console.log(`\n📈 Total paths: ${dataRows.length}`)
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs()

  console.log('🚀 CloudFront Access Logs Query Tool')
  console.log('====================================')
  console.log(`📅 Date: ${options.date}`)
  if (options.path) {
    console.log(`🔍 Path Filter: ${options.path}`)
  }
  console.log(`📊 Query Type: path_usage`)
  console.log('')

  // Parse date into components
  const [year, monthStr, dayStr] = options.date.split('-')
  const month = monthStr.padStart(2, '0')
  const day = dayStr.padStart(2, '0')

  // Build and execute query
  console.log('🔍 Executing Athena query...')
  const query = buildPathUsageQuery(year, month, day, options.path)

  try {
    const resultSet = await executeQuery(query)
    displayResults(resultSet)
  } catch (error) {
    console.error('\n❌ Query failed:', error.message)
    process.exit(1)
  }
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
