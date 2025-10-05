// Test what the CloudFront Function actually sees

const testEvent = {
  request: {
    headers: {
      'x-api-key': { value: 'pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx' },
      'host': { value: 'd3o60fb1dwgq5k.cloudfront.net' }
    },
    querystring: {}
  }
}

function handler(event) {
  var request = event.request
  var headers = request.headers

  // Extract API key from x-api-key header
  var apiKey = headers['x-api-key'] ? headers['x-api-key'].value : 'no-key'

  // Add API key to querystring for CloudFront logging
  request.querystring['cf_api_key'] = { value: apiKey }

  return request
}

// Test it
const result = handler(testEvent)
console.log('Result:', JSON.stringify(result, null, 2))
console.log('Querystring:', result.querystring)
