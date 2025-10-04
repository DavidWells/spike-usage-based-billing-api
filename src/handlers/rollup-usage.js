/**
 * Daily rollup Lambda function
 * Queries CloudFront logs via Athena and stores aggregated usage in DynamoDB
 */

const {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand
} = require('@aws-sdk/client-athena');
const {
  DynamoDBClient,
  UpdateItemCommand
} = require('@aws-sdk/client-dynamodb');

const athena = new AthenaClient();
const dynamodb = new DynamoDBClient();

const ATHENA_DATABASE = process.env.ATHENA_DATABASE;
const ATHENA_OUTPUT_BUCKET = process.env.ATHENA_OUTPUT_BUCKET;
const USAGE_METRICS_TABLE = process.env.USAGE_METRICS_TABLE;

/**
 * Wait for Athena query to complete
 */
async function waitForQueryResults(queryExecutionId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await athena.send(
      new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId })
    );

    const state = response.QueryExecution.Status.State;

    if (state === 'SUCCEEDED') {
      return true;
    } else if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(
        `Query failed: ${response.QueryExecution.Status.StateChangeReason}`
      );
    }

    // Wait 2 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error('Query timed out');
}

/**
 * Execute Athena query and return results
 */
async function executeAthenaQuery(query) {
  console.log('Executing Athena query:', query);

  const queryExecution = await athena.send(
    new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: ATHENA_DATABASE },
      ResultConfiguration: { OutputLocation: ATHENA_OUTPUT_BUCKET },
    })
  );

  const queryExecutionId = queryExecution.QueryExecutionId;
  console.log('Query execution ID:', queryExecutionId);

  await waitForQueryResults(queryExecutionId);

  const results = await athena.send(
    new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId })
  );

  return results.ResultSet.Rows;
}

/**
 * Parse API key from CloudFront query string
 */
function parseApiKeyFromQueryString(queryString) {
  if (!queryString || queryString === '-') {
    return 'no-key';
  }

  // Extract cf_api_key parameter that was added by CloudFront function
  const match = queryString.match(/cf_api_key=([^&]+)/);
  return match ? match[1] : 'no-key';
}

/**
 * Store usage data in DynamoDB
 */
async function storeUsageMetrics(apiKey, date, metrics) {
  console.log('Storing metrics for', apiKey, date, metrics);

  await dynamodb.send(
    new UpdateItemCommand({
      TableName: USAGE_METRICS_TABLE,
      Key: {
        api_key: { S: apiKey },
        date: { S: date },
      },
      UpdateExpression: `
        ADD request_count :req,
            total_bytes :bytes,
            total_latency :lat
        SET last_updated = :updated
      `,
      ExpressionAttributeValues: {
        ':req': { N: metrics.request_count.toString() },
        ':bytes': { N: metrics.total_bytes.toString() },
        ':lat': { N: metrics.total_latency.toString() },
        ':updated': { S: new Date().toISOString() },
      },
    })
  );
}

/**
 * Main handler function
 */
module.exports.handler = async (event) => {
  console.log('Rollup event:', JSON.stringify(event, null, 2));

  try {
    // Calculate date to process (yesterday by default)
    const targetDate = event.date || getYesterdayDate();
    console.log('Processing date:', targetDate);

    // Query CloudFront logs via Athena
    const query = `
      SELECT
        regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1) as api_key,
        COUNT(*) as request_count,
        SUM(sc_bytes) as total_bytes,
        SUM(time_taken) as total_latency
      FROM cloudfront_logs
      WHERE date = DATE '${targetDate}'
        AND cs_uri_query LIKE '%cf_api_key=%'
      GROUP BY regexp_extract(cs_uri_query, 'cf_api_key=([^&]+)', 1)
    `;

    const rows = await executeAthenaQuery(query);

    // Skip header row
    const dataRows = rows.slice(1);

    console.log(`Found ${dataRows.length} API keys with usage`);

    // Store results in DynamoDB
    for (const row of dataRows) {
      const [apiKey, requestCount, totalBytes, totalLatency] = row.Data.map(
        (d) => d.VarCharValue
      );

      await storeUsageMetrics(apiKey, targetDate, {
        request_count: parseInt(requestCount, 10),
        total_bytes: parseInt(totalBytes, 10),
        total_latency: parseFloat(totalLatency),
      });
    }

    console.log('Rollup completed successfully');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Usage rollup completed',
        date: targetDate,
        apiKeysProcessed: dataRows.length,
      }),
    };
  } catch (error) {
    console.error('Rollup failed:', error);
    throw error;
  }
};

/**
 * Get yesterday's date in YYYY-MM-DD format
 */
function getYesterdayDate() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}
