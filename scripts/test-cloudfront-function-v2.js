// Test CloudFront Function with existing querystring

const testEvent = {
  request: {
    headers: {
      'x-api-key': { value: 'pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx' },
      'host': { value: 'd3o60fb1dwgq5k.cloudfront.net' }
    },
    querystring: {
      'test': { value: '123' }
    }
  }
}

function handler(event) {
  var request = event.request
  var headers = request.headers

  // CloudFront normalizes all header names to lowercase
  var apiKey = 'no-key'
  if (headers['x-api-key']) {
    apiKey = headers['x-api-key'].value
  }

  // Initialize querystring if it doesn't exist
  if (!request.querystring) {
    request.querystring = {}
  }

  // Add API key to querystring for logging
  request.querystring['cf_api_key'] = { value: apiKey }

  return request
}

// Test it
const result = handler(testEvent)
console.log('Result:', JSON.stringify(result, null, 2))
console.log('\nQuerystring keys:', Object.keys(result.querystring))
console.log('Has test param?', 'test' in result.querystring)
console.log('Has cf_api_key param?', 'cf_api_key' in result.querystring)
