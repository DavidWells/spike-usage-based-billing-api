/**
 * Get usage metrics for an API key
 * This endpoint can be used to fetch billing data for a specific API key and date range
 */

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient();
const USAGE_METRICS_TABLE = process.env.USAGE_METRICS_TABLE;

/**
 * Query monthly usage for an API key
 */
async function getMonthlyUsage(apiKey, month) {
  const response = await dynamodb.send(
    new QueryCommand({
      TableName: USAGE_METRICS_TABLE,
      KeyConditionExpression: 'api_key = :key AND begins_with(#date, :month)',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: {
        ':key': { S: apiKey },
        ':month': { S: month }, // Format: '2025-10'
      },
    })
  );

  // Sum up daily totals
  const totals = response.Items.reduce(
    (sum, item) => ({
      request_count: sum.request_count + parseInt(item.request_count.N, 10),
      total_bytes: sum.total_bytes + parseInt(item.total_bytes.N, 10),
      total_latency: sum.total_latency + parseFloat(item.total_latency.N),
    }),
    { request_count: 0, total_bytes: 0, total_latency: 0 }
  );

  return {
    apiKey,
    month,
    requestCount: totals.request_count,
    totalBytes: totals.total_bytes,
    totalLatency: totals.total_latency,
    averageLatency:
      totals.request_count > 0
        ? totals.total_latency / totals.request_count
        : 0,
    dailyRecords: response.Items.length,
  };
}

/**
 * Main handler function
 */
module.exports.handler = async (event) => {
  console.log('Get usage event:', JSON.stringify(event, null, 2));

  try {
    // Parse query parameters
    const apiKey = event.queryStringParameters?.api_key;
    const month = event.queryStringParameters?.month; // Format: YYYY-MM

    if (!apiKey) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'api_key parameter is required',
        }),
      };
    }

    if (!month) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'month parameter is required (format: YYYY-MM)',
        }),
      };
    }

    const usage = await getMonthlyUsage(apiKey, month);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(usage),
    };
  } catch (error) {
    console.error('Error fetching usage:', error);

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Failed to fetch usage data',
        message: error.message,
      }),
    };
  }
};
