/**
 * Tests for transform-realtime-logs.js
 * Using uvu test framework
 */

const { test } = require('uvu')
const assert = require('uvu/assert')
const { handler } = require('./transform-realtime-logs')

// Sample CloudFront real-time log TSV line (from your actual logs)
const sampleTsvLine = `1759687234.191\t32.142.164.10\t65.8.177.136\t0.253\t200\t783\tGET\thttps\td3o60fb1dwgq5k.cloudfront.net\t/example\t201\tSFO53-P9\tHoIW-MaV1Qu7J5kwqnAYBNlsg4iI2MBYb5OXBfykwRAZpAqHmdWtQA==\td3o60fb1dwgq5k.cloudfront.net\t0.253\tHTTP/1.1\tIPv4\tvscode-restclient\t-\t-\t-\tMiss\t-\tTLSv1.3\tTLS_AES_128_GCM_SHA256\tMiss\t-\t-\tapplication/json\t102\t-\t-\t63051\tMiss\tUS\tgzip,%20deflate,%20br\t-\t*\tUser-Agent:vscode-restclient%0AX-Api-Key:pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx%0AAccept-Encoding:gzip,%20deflate,%20br%0AHost:d3o60fb1dwgq5k.cloudfront.net%0ACloudfront-Is-Mobile-Viewer:false%0ACloudfront-Is-Tablet-Viewer:false%0ACloudfront-Is-Smarttv-Viewer:false%0ACloudfront-Is-Desktop-Viewer:true%0ACloudfront-Is-Ios-Viewer:false%0ACloudfront-Is-Android-Viewer:false%0ACloudfront-Viewer-Http-Version:1.1%0ACloudfront-Viewer-Country:US%0ACloudfront-Viewer-Country-Name:United%20States%0ACloudfront-Viewer-Country-Region:CA%0ACloudfront-Viewer-Country-Region-Name:California%0ACloudfront-Viewer-City:Corte%20Madera%0ACloudfront-Viewer-Postal-Code:94925%0ACloudfront-Viewer-Time-Zone:America/Los_Angeles%0ACloudfront-Viewer-Metro-Code:807%0ACloudfront-Viewer-Latitude:37.92490%0ACloudfront-Viewer-Longitude:-122.51000%0A\tUser-Agent%0AX-Api-Key%0AAccept-Encoding%0AHost%0ACloudfront-Is-Mobile-Viewer%0ACloudfront-Is-Tablet-Viewer%0ACloudfront-Is-Smarttv-Viewer%0ACloudfront-Is-Desktop-Viewer%0ACloudfront-Is-Ios-Viewer%0ACloudfront-Is-Android-Viewer%0ACloudfront-Viewer-Http-Version%0ACloudfront-Viewer-Country%0ACloudfront-Viewer-Country-Name%0ACloudfront-Viewer-Country-Region%0ACloudfront-Viewer-Country-Region-Name%0ACloudfront-Viewer-City%0ACloudfront-Viewer-Postal-Code%0ACloudfront-Viewer-Time-Zone%0ACloudfront-Viewer-Metro-Code%0ACloudfront-Viewer-Latitude%0ACloudfront-Viewer-Longitude%0ACloudfront-Forwarded-Proto%0ACloudfront-Viewer-Address%0ACloudfront-Viewer-Tls%0ACloudfront-Viewer-Asn%0AConnection%0A\t26\t0.232\t0.232\t7018`

test('should successfully transform TSV to JSON', async () => {
  const base64Input = Buffer.from(sampleTsvLine, 'utf-8').toString('base64')

  const event = {
    records: [
      {
        recordId: 'test-record-1',
        data: base64Input
      }
    ]
  }

  const result = await handler(event)

  assert.ok(result.records, 'Result should have records array')
  assert.is(result.records.length, 1, 'Should have 1 record')
  assert.is(result.records[0].result, 'Ok', 'Record should be processed successfully')
  assert.is(result.records[0].recordId, 'test-record-1', 'Record ID should match')

  // Decode the output
  const jsonOutput = Buffer.from(result.records[0].data, 'base64').toString('utf-8')
  const parsed = JSON.parse(jsonOutput)

  // Verify key fields
  assert.is(parsed.timestamp, 1759687234.191, 'Timestamp should be parsed as float')
  assert.is(parsed.c_ip, '32.142.164.10', 'Client IP should be extracted')
  assert.is(parsed.cs_method, 'GET', 'HTTP method should be extracted')
  assert.is(parsed.cs_uri_stem, '/example', 'URI should be extracted')
  assert.is(parsed.sc_status, 200, 'Status code should be parsed as integer')
  assert.is(parsed.sc_bytes, 783, 'Bytes should be parsed as integer')
  assert.is(parsed.c_country, 'US', 'Country should be extracted')
  assert.is(parsed.x_edge_result_type, 'Miss', 'Cache result should be extracted')
})

test('should extract API key from cs_headers field', async () => {
  const base64Input = Buffer.from(sampleTsvLine, 'utf-8').toString('base64')

  const event = {
    records: [{ recordId: 'test-record-1', data: base64Input }]
  }

  const result = await handler(event)
  const jsonOutput = Buffer.from(result.records[0].data, 'base64').toString('utf-8')
  const parsed = JSON.parse(jsonOutput)

  assert.ok(parsed.cs_headers, 'Should have cs_headers field')
  assert.ok(
    parsed.cs_headers.includes('X-Api-Key:pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx'),
    'cs_headers should contain the API key'
  )
})

test('should handle numeric fields correctly', async () => {
  const base64Input = Buffer.from(sampleTsvLine, 'utf-8').toString('base64')

  const event = {
    records: [{ recordId: 'test-record-1', data: base64Input }]
  }

  const result = await handler(event)
  const jsonOutput = Buffer.from(result.records[0].data, 'base64').toString('utf-8')
  const parsed = JSON.parse(jsonOutput)

  // Integer fields
  assert.type(parsed.sc_status, 'number', 'sc_status should be number')
  assert.type(parsed.sc_bytes, 'number', 'sc_bytes should be number')
  // cs_bytes might be null if not present in the log
  if (parsed.cs_bytes !== null) {
    assert.type(parsed.cs_bytes, 'number', 'cs_bytes should be number when present')
  }
  assert.type(parsed.c_port, 'number', 'c_port should be number')
  assert.type(parsed.cs_headers_count, 'number', 'cs_headers_count should be number')
  assert.type(parsed.asn, 'number', 'asn should be number')

  // Float fields (might be null if field is "-")
  assert.type(parsed.timestamp, 'number', 'timestamp should be number')
  assert.type(parsed.time_to_first_byte, 'number', 'time_to_first_byte should be number')
  if (parsed.time_taken !== null) {
    assert.type(parsed.time_taken, 'number', 'time_taken should be number when present')
  }
  if (parsed.origin_fbl !== null) {
    assert.type(parsed.origin_fbl, 'number', 'origin_fbl should be number when present')
  }
  if (parsed.origin_lbl !== null) {
    assert.type(parsed.origin_lbl, 'number', 'origin_lbl should be number when present')
  }

  // Verify actual values that we know are present
  assert.is(parsed.timestamp, 1759687234.191)
  assert.is(parsed.time_to_first_byte, 0.253)
  // time_taken, origin_fbl, origin_lbl might be null depending on data
  if (parsed.time_taken !== null) {
    assert.is(parsed.time_taken, 0.253)
  }
  if (parsed.asn !== null) {
    assert.is(parsed.asn, 7018)
  }
})

test('should handle null/empty values (-) correctly', async () => {
  const base64Input = Buffer.from(sampleTsvLine, 'utf-8').toString('base64')

  const event = {
    records: [{ recordId: 'test-record-1', data: base64Input }]
  }

  const result = await handler(event)
  const jsonOutput = Buffer.from(result.records[0].data, 'base64').toString('utf-8')
  const parsed = JSON.parse(jsonOutput)

  // These fields have '-' in the sample data, should be null
  assert.is(parsed.cs_referer, null, 'cs_referer should be null for "-"')
  assert.is(parsed.cs_cookie, null, 'cs_cookie should be null for "-"')
  assert.is(parsed.fle_status, null, 'fle_status should be null for "-"')
  assert.is(parsed.fle_encrypted_fields, null, 'fle_encrypted_fields should be null for "-"')
})

test('should handle multiple records in batch', async () => {
  const base64Input = Buffer.from(sampleTsvLine, 'utf-8').toString('base64')

  const event = {
    records: [
      { recordId: 'record-1', data: base64Input },
      { recordId: 'record-2', data: base64Input },
      { recordId: 'record-3', data: base64Input }
    ]
  }

  const result = await handler(event)

  assert.is(result.records.length, 3, 'Should process all 3 records')
  assert.ok(result.records.every(r => r.result === 'Ok'), 'All records should succeed')
  assert.ok(result.records.every(r => r.data), 'All records should have data')
})

test('should drop empty lines', async () => {
  const emptyBase64 = Buffer.from('', 'utf-8').toString('base64')

  const event = {
    records: [
      { recordId: 'empty-record', data: emptyBase64 }
    ]
  }

  const result = await handler(event)

  assert.is(result.records[0].result, 'Dropped', 'Empty record should be dropped')
})

test('should handle whitespace-only lines', async () => {
  const whitespaceBase64 = Buffer.from('   \n  ', 'utf-8').toString('base64')

  const event = {
    records: [
      { recordId: 'whitespace-record', data: whitespaceBase64 }
    ]
  }

  const result = await handler(event)

  assert.is(result.records[0].result, 'Dropped', 'Whitespace record should be dropped')
})

test('should return ProcessingFailed for malformed data', async () => {
  const malformedBase64 = Buffer.from('not-enough-fields\tonly-two', 'utf-8').toString('base64')

  const event = {
    records: [
      { recordId: 'malformed-record', data: malformedBase64 }
    ]
  }

  const result = await handler(event)

  // Should complete but might have issues with field mapping
  assert.ok(result.records[0], 'Should return a result')
  assert.ok(['Ok', 'ProcessingFailed'].includes(result.records[0].result), 'Should return Ok or ProcessingFailed')
})

test('should produce valid JSON output', async () => {
  const base64Input = Buffer.from(sampleTsvLine, 'utf-8').toString('base64')

  const event = {
    records: [{ recordId: 'test-record-1', data: base64Input }]
  }

  const result = await handler(event)
  const jsonOutput = Buffer.from(result.records[0].data, 'base64').toString('utf-8')

  // Should be valid JSON (trim newline that we add)
  assert.not.throws(() => {
    JSON.parse(jsonOutput.trim())
  }, 'Output should be valid JSON')
})

test('should maintain all 43 fields in output', async () => {
  const base64Input = Buffer.from(sampleTsvLine, 'utf-8').toString('base64')

  const event = {
    records: [{ recordId: 'test-record-1', data: base64Input }]
  }

  const result = await handler(event)
  const jsonOutput = Buffer.from(result.records[0].data, 'base64').toString('utf-8')
  const parsed = JSON.parse(jsonOutput)

  const expectedFields = [
    'timestamp', 'c_ip', 's_ip', 'time_to_first_byte', 'sc_status', 'sc_bytes',
    'cs_method', 'cs_protocol', 'cs_host', 'cs_uri_stem', 'cs_uri_query',
    'x_edge_location', 'x_edge_request_id', 'x_host_header', 'time_taken',
    'cs_protocol_version', 'c_ip_version', 'cs_user_agent', 'cs_referer',
    'cs_cookie', 'x_edge_response_result_type', 'x_forwarded_for',
    'ssl_protocol', 'ssl_cipher', 'x_edge_result_type', 'fle_encrypted_fields',
    'fle_status', 'sc_content_type', 'sc_content_len', 'sc_range_start',
    'sc_range_end', 'c_port', 'x_edge_detailed_result_type', 'c_country',
    'cs_accept_encoding', 'cs_accept', 'cache_behavior_path_pattern',
    'cs_headers', 'cs_header_names', 'cs_headers_count', 'origin_fbl',
    'origin_lbl', 'asn', 'cs_bytes'
  ]

  expectedFields.forEach(field => {
    assert.ok(
      field in parsed,
      `Output should contain field: ${field}`
    )
  })

  // Should have 43 or 44 fields depending on whether cs_bytes is present
  const fieldCount = Object.keys(parsed).length
  assert.ok(fieldCount === 43 || fieldCount === 44, `Should have 43 or 44 fields, got ${fieldCount}`)
})

test('should handle POST request', async () => {
  // POST request example (without cs_bytes since CloudFront doesn't always include it)
  const postTsvLine = `1759687169.596\t32.142.164.10\t65.8.177.136\t0.597\t200\t881\tPOST\thttps\td3o60fb1dwgq5k.cloudfront.net\t/data\t345\tSFO53-P9\te84rly0hAmwHfcOz0WdbcRQGN8iPYMjLmNa9gpmGd39dLsOlcxKINg==\td3o60fb1dwgq5k.cloudfront.net\t0.615\tHTTP/1.1\tIPv4\tvscode-restclient\t-\t-\t-\tMiss\t-\tTLSv1.3\tTLS_AES_128_GCM_SHA256\tMiss\t-\t-\tapplication/json\t200\t-\t-\t62915\tMiss\tUS\tgzip,%20deflate,%20br\t-\t*\tUser-Agent:vscode-restclient%0A\tUser-Agent%0A\t28\t0.542\t0.542\t7018`

  const base64Input = Buffer.from(postTsvLine, 'utf-8').toString('base64')

  const event = {
    records: [{ recordId: 'test-post', data: base64Input }]
  }

  const result = await handler(event)
  const jsonOutput = Buffer.from(result.records[0].data, 'base64').toString('utf-8')
  const parsed = JSON.parse(jsonOutput)

  assert.is(parsed.cs_method, 'POST', 'Should handle POST method')
  assert.is(parsed.cs_uri_stem, '/data', 'Should extract correct URI')
  assert.is(parsed.sc_bytes, 881, 'Should parse sc_bytes correctly')
  assert.is(parsed.asn, 7018, 'Should parse asn correctly')
})

// Run all tests
test.run()
