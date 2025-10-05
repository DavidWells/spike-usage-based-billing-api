#!/usr/bin/env node
// ABOUTME: Test script that makes requests to CloudFront endpoints with rotating API keys
// ABOUTME: Used to generate test data for usage tracking validation

const https = require('https')

const BASE_URL = 'https://d3o60fb1dwgq5k.cloudfront.net'

const API_KEYS = [
  'pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx', // apiKey1
  'GYGtqyWIyD1vdVJ3E3L6j4w9kxAe3Bld1zaBMqV1', // apiKey2
  'fake-key-here' // Invalid key for testing
]

/**
 * Make HTTP request
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {string} apiKey - API key header value
 * @param {object} body - Request body (for POST)
 * @returns {Promise<object>}
 */
function makeRequest(method, path, apiKey, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL)

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: method,
      headers: {
        'x-api-key': apiKey,
        'User-Agent': 'request-test-script'
      }
    }

    if (body) {
      const bodyString = JSON.stringify(body)
      options.headers['Content-Type'] = 'application/json'
      options.headers['Content-Length'] = Buffer.byteLength(bodyString)
    }

    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        })
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    if (body) {
      req.write(JSON.stringify(body))
    }

    req.end()
  })
}

/**
 * Make GET request to /example
 */
async function testGetExample(apiKey, keyName) {
  console.log(`\n🔵 GET /example with ${keyName}`)
  try {
    const response = await makeRequest('GET', '/example', apiKey)
    console.log(`   Status: ${response.status}`)
    console.log(`   Body: ${response.body}`)
  } catch (error) {
    console.error(`   Error: ${error.message}`)
  }
}

/**
 * Make POST request to /data
 */
async function testPostData(apiKey, keyName) {
  console.log(`\n🟢 POST /data with ${keyName}`)
  const body = {
    message: 'Test data for usage tracking',
    userId: 'user123',
    action: 'api_call'
  }

  try {
    const response = await makeRequest('POST', '/data', apiKey, body)
    console.log(`   Status: ${response.status}`)
    console.log(`   Body: ${response.body}`)
  } catch (error) {
    console.error(`   Error: ${error.message}`)
  }
}

/**
 * Main test runner
 */
async function runTests() {
  const numRequests = parseInt(process.argv[2]) || 5

  console.log('🚀 CloudFront API Request Test Script')
  console.log('=====================================')
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`Number of requests per endpoint: ${numRequests}`)
  console.log(`API Keys: ${API_KEYS.length} (2 valid, 1 fake)`)

  let keyIndex = 0

  for (let i = 0; i < numRequests; i++) {
    const apiKey = API_KEYS[keyIndex % API_KEYS.length]
    const keyName = keyIndex % API_KEYS.length === 0 ? 'apiKey1'
                  : keyIndex % API_KEYS.length === 1 ? 'apiKey2'
                  : 'fake-key'

    console.log(`\n--- Request ${i + 1}/${numRequests} ---`)

    await testGetExample(apiKey, keyName)
    await new Promise(resolve => setTimeout(resolve, 500)) // Small delay

    await testPostData(apiKey, keyName)
    await new Promise(resolve => setTimeout(resolve, 500)) // Small delay

    keyIndex++
  }

  console.log('\n✅ Test script completed!')
  console.log('\nℹ️  Wait 5 minutes for Firehose to flush data to S3')
  console.log('ℹ️  Then run: node scripts/query-usage.js --date 2025-10-05')
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error)
  process.exit(1)
})
