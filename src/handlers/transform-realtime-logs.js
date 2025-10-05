/**
 * Kinesis Firehose Data Transformation Lambda
 * Converts CloudFront real-time logs from TSV to JSON for Parquet conversion
 * Uses papaparse for reliable TSV parsing
 */

const Papa = require('papaparse')

// CloudFront real-time log field names (order from serverless.yml Fields config)
// NOTE: cs-bytes is configured but CloudFront doesn't always include it in output
const FIELD_NAMES = [
  'timestamp',
  'c_ip',
  's_ip',
  'time_to_first_byte',
  'sc_status',
  'sc_bytes',
  'cs_method',
  'cs_protocol',
  'cs_host',
  'cs_uri_stem',
  'cs_uri_query',
  'cs_bytes',  // Often missing in actual logs
  'x_edge_location',
  'x_edge_request_id',
  'x_host_header',
  'time_taken',
  'cs_protocol_version',
  'c_ip_version',
  'cs_user_agent',
  'cs_referer',
  'cs_cookie',
  'x_edge_response_result_type',
  'x_forwarded_for',
  'ssl_protocol',
  'ssl_cipher',
  'x_edge_result_type',
  'fle_encrypted_fields',
  'fle_status',
  'sc_content_type',
  'sc_content_len',
  'sc_range_start',
  'sc_range_end',
  'c_port',
  'x_edge_detailed_result_type',
  'c_country',
  'cs_accept_encoding',
  'cs_accept',
  'cache_behavior_path_pattern',
  'cs_headers',
  'cs_header_names',
  'cs_headers_count',
  'origin_fbl',
  'origin_lbl',
  'asn'
]

/**
 * Convert CloudFront field value to proper type
 */
function convertFieldType(fieldName, value) {
  // Handle null/empty values
  if (!value || value === '-') {
    return null
  }

  // Integer fields
  if ([
    'sc_status',
    'sc_bytes',
    'cs_bytes',
    'sc_content_len',
    'sc_range_start',
    'sc_range_end',
    'c_port',
    'fle_encrypted_fields',
    'cs_headers_count',
    'asn'
  ].includes(fieldName)) {
    return parseInt(value, 10)
  }

  // Timestamp - convert to milliseconds as bigint
  if (fieldName === 'timestamp') {
    return Math.floor(parseFloat(value) * 1000)
  }

  // Float/Double fields
  if ([
    'time_to_first_byte',
    'time_taken',
    'origin_fbl',
    'origin_lbl'
  ].includes(fieldName)) {
    return parseFloat(value)
  }

  // String fields - return as-is
  return value
}

/**
 * Extract API key from cs_headers field
 * @param {string} csHeaders - URL-encoded headers string
 * @returns {string|null} - Decoded API key or null
 */
function extractApiKey(csHeaders) {
  if (!csHeaders) return null

  try {
    // Match X-Api-Key header (case-insensitive)
    const match = csHeaders.match(/X-Api-Key:([^%\n]+)/i)
    if (match && match[1]) {
      return decodeURIComponent(match[1])
    }
    return null
  } catch (error) {
    console.warn('Failed to extract API key:', error.message)
    return null
  }
}

/**
 * Parse TSV line to JSON using papaparse
 */
function parseTsvToJson(tsvLine) {
  // Parse TSV with papaparse
  const parsed = Papa.parse(tsvLine, {
    delimiter: '\t',
    header: false,
    skipEmptyLines: true
  })

  if (parsed.errors.length > 0) {
    throw new Error(`Parse error: ${parsed.errors[0].message}`)
  }

  if (!parsed.data || parsed.data.length === 0) {
    throw new Error('No data parsed from TSV')
  }

  const values = parsed.data[0]

  // Build JSON object with proper field names
  const record = {}

  // Use the actual number of values we got (might be less than FIELD_NAMES if cs_bytes is missing)
  const fieldCount = Math.min(values.length, FIELD_NAMES.length)

  for (let i = 0; i < fieldCount; i++) {
    const fieldName = FIELD_NAMES[i]
    const value = values[i]
    record[fieldName] = convertFieldType(fieldName, value)
  }

  // Extract API key from cs_headers and add as separate field
  if (record.cs_headers) {
    record.api_key = extractApiKey(record.cs_headers)
  } else {
    record.api_key = null
  }

  return record
}

/**
 * Main Lambda handler for Firehose transformation
 */
module.exports.handler = async (event) => {
  console.log('Received records:', event.records.length)

  const output = event.records.map((record) => {
    try {
      // Decode base64 TSV data
      const tsvData = Buffer.from(record.data, 'base64').toString('utf-8')

      // Skip empty lines
      if (!tsvData || tsvData.trim() === '') {
        return {
          recordId: record.recordId,
          result: 'Dropped',
          data: record.data
        }
      }

      // Parse TSV to JSON using papaparse
      const jsonData = parseTsvToJson(tsvData.trim())

      // Convert JSON to base64 for Firehose
      const jsonString = JSON.stringify(jsonData)
      const base64Json = Buffer.from(jsonString + '\n', 'utf-8').toString('base64')

      console.log('Transformed record:', record.recordId)

      return {
        recordId: record.recordId,
        result: 'Ok',
        data: base64Json
      }
    } catch (error) {
      console.error('Error processing record:', record.recordId, error.message)

      // Return original data on error (Firehose will send to error bucket)
      return {
        recordId: record.recordId,
        result: 'ProcessingFailed',
        data: record.data
      }
    }
  })

  console.log('Successfully processed:', output.filter(r => r.result === 'Ok').length)
  console.log('Failed:', output.filter(r => r.result === 'ProcessingFailed').length)
  console.log('Dropped:', output.filter(r => r.result === 'Dropped').length)

  return { records: output }
}
