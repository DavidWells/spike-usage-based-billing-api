#!/usr/bin/env node

// ABOUTME: Script to manually invoke the usage rollup Lambda function
// ABOUTME: Allows triggering rollup without waiting for the cron schedule

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda')

const lambda = new LambdaClient({ region: 'us-east-1' })

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2)
  let date = null
  let queryType = 'daily_usage'
  let stage = 'dev'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) {
      date = args[i + 1]
      i++
    } else if (args[i] === '--query-type' && args[i + 1]) {
      queryType = args[i + 1]
      i++
    } else if (args[i] === '--stage' && args[i + 1]) {
      stage = args[i + 1]
      i++
    }
  }

  // Default to yesterday if no date provided
  if (!date) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    date = yesterday.toISOString().split('T')[0]
  }

  return { date, queryType, stage }
}

/**
 * Invoke the rollup Lambda function
 */
async function invokeRollup(date, queryType, stage) {
  const functionName = `usage-billing-api-${stage}-rollupUsage`

  console.log('🚀 Invoking rollup function')
  console.log('===========================')
  console.log(`📦 Function: ${functionName}`)
  console.log(`📅 Date: ${date}`)
  console.log(`📊 Query Type: ${queryType}`)
  console.log('')

  const payload = {
    date,
    queryType
  }

  try {
    const response = await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(payload)
      })
    )

    // Parse response
    const result = JSON.parse(new TextDecoder().decode(response.Payload))

    if (response.FunctionError) {
      console.error('❌ Function Error:', response.FunctionError)
      console.error('Response:', JSON.stringify(result, null, 2))
      process.exit(1)
    }

    // Parse the body if it's a Lambda proxy response
    let body = result
    if (result.body && typeof result.body === 'string') {
      body = JSON.parse(result.body)
    }

    console.log('✅ Rollup completed successfully')
    console.log('')
    console.log('📊 Results:')
    console.log(`   API Keys Processed: ${body.apiKeysProcessed || 0}`)
    console.log(`   Date: ${body.date}`)
    console.log(`   Timestamp: ${body.timestamp}`)
    console.log(`   Query Type: ${body.queryType}`)
    console.log('')

    if (body.results && body.results.length > 0) {
      console.log('📈 Sample Results (first 10):')
      body.results.forEach((row, idx) => {
        console.log(`   ${idx + 1}. ${row.join(' | ')}`)
      })
    }

    console.log('')
    console.log('💾 Full results stored in DynamoDB')

  } catch (error) {
    console.error('❌ Error invoking function:', error.message)

    if (error.name === 'ResourceNotFoundException') {
      console.error('')
      console.error('Function not found. Make sure you have deployed the stack:')
      console.error(`  serverless deploy --stage ${stage}`)
    }

    process.exit(1)
  }
}

/**
 * Main function
 */
async function main() {
  const { date, queryType, stage } = parseArgs()

  // Validate query type
  const validQueryTypes = ['daily_usage', 'billing', 'cache_discount']
  if (!validQueryTypes.includes(queryType)) {
    console.error(`❌ Invalid query type: ${queryType}`)
    console.error(`   Valid types: ${validQueryTypes.join(', ')}`)
    process.exit(1)
  }

  await invokeRollup(date, queryType, stage)
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Error:', error.message)
    process.exit(1)
  })
}

module.exports = { invokeRollup }
