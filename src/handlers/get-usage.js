/**
 * Get usage metrics for an API key
 * This endpoint can be used to fetch billing data for a specific API key and date range
 */

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient();
const USAGE_METRICS_TABLE = process.env.USAGE_METRICS_TABLE;

/**
 * Query usage for an API key by date range
 * Supports querying by month (YYYY-MM), day (YYYY-MM-DD), or hour (YYYY-MM-DDTHH)
 */
async function getUsage(apiKey, datePrefix) {
  const response = await dynamodb.send(
    new QueryCommand({
      TableName: USAGE_METRICS_TABLE,
      KeyConditionExpression: 'api_key = :key AND begins_with(#date, :prefix)',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: {
        ':key': { S: apiKey },
        ':prefix': { S: datePrefix }, // Format: 'YYYY-MM', 'YYYY-MM-DD', or 'YYYY-MM-DDTHH'
      },
    })
  )

  // Sum up totals across all matching records
  const totals = response.Items.reduce(
    (sum, item) => ({
      request_count: sum.request_count + parseInt(item.request_count?.N || '0', 10),
      total_bytes_sent: sum.total_bytes_sent + parseInt(item.total_bytes_sent?.N || '0', 10),
      total_bytes_received: sum.total_bytes_received + parseInt(item.total_bytes_received?.N || '0', 10),
      successful_requests: sum.successful_requests + parseInt(item.successful_requests?.N || '0', 10),
      error_requests: sum.error_requests + parseInt(item.error_requests?.N || '0', 10),
      cache_hits: sum.cache_hits + parseInt(item.cache_hits?.N || '0', 10),
      cache_misses: sum.cache_misses + parseInt(item.cache_misses?.N || '0', 10),
      total_response_time: sum.total_response_time + (parseFloat(item.avg_response_time_ms?.N || '0') * parseInt(item.request_count?.N || '0', 10)),
    }),
    {
      request_count: 0,
      total_bytes_sent: 0,
      total_bytes_received: 0,
      successful_requests: 0,
      error_requests: 0,
      cache_hits: 0,
      cache_misses: 0,
      total_response_time: 0
    }
  )

  return {
    apiKey,
    datePrefix,
    requestCount: totals.request_count,
    totalBytesSent: totals.total_bytes_sent,
    totalBytesReceived: totals.total_bytes_received,
    successfulRequests: totals.successful_requests,
    errorRequests: totals.error_requests,
    cacheHits: totals.cache_hits,
    cacheMisses: totals.cache_misses,
    averageResponseTimeMs: totals.request_count > 0 ? totals.total_response_time / totals.request_count : 0,
    cacheHitRate: (totals.cache_hits + totals.cache_misses) > 0
      ? (totals.cache_hits / (totals.cache_hits + totals.cache_misses) * 100).toFixed(2)
      : 0,
    records: response.Items.length,
  }
}

/**
 * Main handler function
 */
module.exports.handler = async (event) => {
  console.log('Get usage event:', JSON.stringify(event, null, 2));

  try {
    // Parse query parameters
    const apiKey = event.queryStringParameters?.api_key
    const datePrefix = event.queryStringParameters?.date || event.queryStringParameters?.month

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
      }
    }

    if (!datePrefix) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'date or month parameter is required (format: YYYY-MM, YYYY-MM-DD, or YYYY-MM-DDTHH)',
        }),
      }
    }

    const usage = await getUsage(apiKey, datePrefix)

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
