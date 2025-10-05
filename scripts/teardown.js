#!/usr/bin/env node

// ABOUTME: Empties all S3 buckets in the stack to enable clean removal
// ABOUTME: Clears CloudFront logs, real-time logs, and Athena results buckets

const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand
} = require('@aws-sdk/client-s3')

const s3 = new S3Client({ region: 'us-east-1' })

/**
 * Get AWS account ID
 */
async function getAccountId() {
  const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts')
  const sts = new STSClient({ region: 'us-east-1' })
  const response = await sts.send(new GetCallerIdentityCommand({}))
  return response.Account
}

/**
 * Empty a bucket by deleting all objects and versions
 */
async function emptyBucket(bucketName) {
  console.log(`\n🗑️  Emptying bucket: ${bucketName}`)

  try {
    // Check if bucket has versioning enabled
    const versioningResponse = await s3.send(
      new GetBucketVersioningCommand({ Bucket: bucketName })
    )
    const isVersioned = versioningResponse.Status === 'Enabled'

    if (isVersioned) {
      console.log('   Bucket has versioning enabled, deleting all versions...')
      await emptyVersionedBucket(bucketName)
    } else {
      console.log('   Deleting all objects...')
      await emptyNonVersionedBucket(bucketName)
    }

    console.log(`   ✅ Successfully emptied ${bucketName}`)
  } catch (error) {
    if (error.name === 'NoSuchBucket') {
      console.log(`   ⚠️  Bucket does not exist: ${bucketName}`)
    } else {
      console.error(`   ❌ Error emptying bucket: ${error.message}`)
      throw error
    }
  }
}

/**
 * Empty a non-versioned bucket
 */
async function emptyNonVersionedBucket(bucketName) {
  let continuationToken = null
  let totalDeleted = 0

  do {
    const listParams = {
      Bucket: bucketName,
      MaxKeys: 1000
    }

    if (continuationToken) {
      listParams.ContinuationToken = continuationToken
    }

    const listResponse = await s3.send(new ListObjectsV2Command(listParams))

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      const deleteParams = {
        Bucket: bucketName,
        Delete: {
          Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
          Quiet: true
        }
      }

      await s3.send(new DeleteObjectsCommand(deleteParams))
      totalDeleted += listResponse.Contents.length
      console.log(`   Deleted ${totalDeleted} objects...`)
    }

    continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : null
  } while (continuationToken)

  console.log(`   Total objects deleted: ${totalDeleted}`)
}

/**
 * Empty a versioned bucket
 */
async function emptyVersionedBucket(bucketName) {
  let keyMarker = null
  let versionIdMarker = null
  let totalDeleted = 0

  do {
    const listParams = {
      Bucket: bucketName,
      MaxKeys: 1000
    }

    if (keyMarker) {
      listParams.KeyMarker = keyMarker
    }
    if (versionIdMarker) {
      listParams.VersionIdMarker = versionIdMarker
    }

    const listResponse = await s3.send(new ListObjectVersionsCommand(listParams))

    const objectsToDelete = []

    // Add all versions
    if (listResponse.Versions) {
      listResponse.Versions.forEach(version => {
        objectsToDelete.push({
          Key: version.Key,
          VersionId: version.VersionId
        })
      })
    }

    // Add all delete markers
    if (listResponse.DeleteMarkers) {
      listResponse.DeleteMarkers.forEach(marker => {
        objectsToDelete.push({
          Key: marker.Key,
          VersionId: marker.VersionId
        })
      })
    }

    if (objectsToDelete.length > 0) {
      const deleteParams = {
        Bucket: bucketName,
        Delete: {
          Objects: objectsToDelete,
          Quiet: true
        }
      }

      await s3.send(new DeleteObjectsCommand(deleteParams))
      totalDeleted += objectsToDelete.length
      console.log(`   Deleted ${totalDeleted} objects/versions...`)
    }

    keyMarker = listResponse.IsTruncated ? listResponse.NextKeyMarker : null
    versionIdMarker = listResponse.IsTruncated ? listResponse.NextVersionIdMarker : null
  } while (keyMarker)

  console.log(`   Total objects/versions deleted: ${totalDeleted}`)
}

/**
 * Parse stage from command line args
 */
function parseArgs() {
  const args = process.argv.slice(2)
  let stage = 'dev'
  let confirm = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && args[i + 1]) {
      stage = args[i + 1]
      i++
    } else if (args[i] === '--confirm') {
      confirm = true
    }
  }

  return { stage, confirm }
}

/**
 * Main function
 */
async function main() {
  const { stage, confirm } = parseArgs()

  console.log('🧹 Serverless Stack Teardown Script')
  console.log('===================================')
  console.log(`📦 Stage: ${stage}`)
  console.log('')

  // Get account ID
  const accountId = await getAccountId()
  console.log(`🔑 AWS Account: ${accountId}`)

  // Construct bucket names based on serverless.yml naming pattern
  const serviceName = 'usage-billing-api'
  const buckets = [
    `${serviceName}-${stage}-cloudfront-logs-${accountId}`,
    `${serviceName}-${stage}-cloudfront-realtime-logs-${accountId}`,
    `${serviceName}-${stage}-athena-results-${accountId}`
  ]

  console.log('\n📋 Buckets to empty:')
  buckets.forEach(bucket => console.log(`   - ${bucket}`))

  if (!confirm) {
    console.log('\n⚠️  WARNING: This will permanently delete all objects in these buckets!')
    console.log('   Run with --confirm to proceed')
    console.log('')
    console.log('   Example: node scripts/teardown.js --confirm')
    console.log('            node scripts/teardown.js --stage prod --confirm')
    process.exit(0)
  }

  console.log('\n🚀 Starting teardown...')

  // Empty each bucket
  for (const bucket of buckets) {
    await emptyBucket(bucket)
  }

  console.log('\n✅ All buckets emptied successfully!')
  console.log('\nYou can now safely remove the stack:')
  console.log(`   serverless remove --stage ${stage}`)
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Error:', error.message)
    process.exit(1)
  })
}

module.exports = { emptyBucket }
