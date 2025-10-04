/**
 * Another example Lambda handler for usage-based billing
 * Demonstrates a POST endpoint with API key tracking
 */

module.exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // Extract API key from the request context
  const apiKey = event.requestContext?.identity?.apiKey || 'unknown';
  const apiKeyId = event.requestContext?.identity?.apiKeyId || 'unknown';

  // Parse request body
  let requestBody = {};
  try {
    requestBody = event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    console.error('Error parsing request body:', error);
  }

  // Log usage information
  console.log('API Usage:', {
    apiKey,
    apiKeyId,
    timestamp: new Date().toISOString(),
    path: event.path,
    method: event.httpMethod,
    sourceIp: event.requestContext?.identity?.sourceIp,
    userAgent: event.requestContext?.identity?.userAgent,
    requestSize: event.body ? event.body.length : 0,
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      message: 'Data received successfully',
      timestamp: new Date().toISOString(),
      apiKeyId: apiKeyId,
      dataReceived: requestBody,
    }),
  };
};
