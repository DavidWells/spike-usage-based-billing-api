
You can't get headers in CF basic logs and appending values to query string in a CF function don't help

  Standard CloudFront access logs (what you have now) include:
  - cs-uri-query - query parameters ✅
  - cs(Cookie) - cookies
  - cs(Referer) - referer header
  - cs(User-Agent) - user agent header
  - But NO generic cs-headers field ❌

  CloudFront real-time logs include:
  - cs-headers - all headers with values ✅
  - cs-header-names - all header names ✅


## Need realtime logs

like https://github.com/ownstats/ownstats/blob/c045e22fcccbb3c43fa39fa60477a6dd26e9d1e0/client/src/plugins/ownstats/index.js + https://github.com/ownstats/ownstats/blob/c045e22fcccbb3c43fa39fa60477a6dd26e9d1e0/backend/resources/cf-distribution.yml#L8