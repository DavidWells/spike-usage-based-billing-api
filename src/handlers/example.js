/**
 * Example Lambda handler for usage-based billing
 * This endpoint requires an API key and logs usage information
 */

module.exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // Extract API key from the request context
  const apiKey = event.requestContext?.identity?.apiKey || 'unknown';
  const apiKeyId = event.requestContext?.identity?.apiKeyId || 'unknown';

  // Log usage information
  console.log('API Usage:', {
    apiKey,
    apiKeyId,
    timestamp: new Date().toISOString(),
    path: event.path,
    method: event.httpMethod,
    sourceIp: event.requestContext?.identity?.sourceIp,
    userAgent: event.requestContext?.identity?.userAgent,
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      message: 'Example endpoint response',
      timestamp: new Date().toISOString(),
      apiKeyId: apiKeyId,
    }),
  };
};
