
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


## Basic log

```
#Version: 1.0
#Fields: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(Referer) cs(User-Agent) cs-uri-query cs(Cookie) x-edge-result-type x-edge-request-id x-host-header cs-protocol cs-bytes time-taken x-forwarded-for ssl-protocol ssl-cipher x-edge-response-result-type cs-protocol-version fle-status fle-encrypted-fields c-port time-to-first-byte x-edge-detailed-result-type sc-content-type sc-content-len sc-range-start sc-range-end
2025-10-05	01:06:21	SFO53-P9	611	32.142.164.10	POST	d3o60fb1dwgq5k.cloudfront.net	/data	200	-	curl/8.7.1	test=123	-	Miss	GjocI0R8eOYh2liL2D6EUlwv1hsI8BY1YIzjpdzw-ZUnqbiF8E2WVQ==	d3o60fb1dwgq5k.cloudfront.net	https	104	0.133	-	TLSv1.3	TLS_AES_128_GCM_SHA256	Miss	HTTP/2.0	-	-	54726	0.133	Miss	application/json	121	-	-
```

## Need realtime logs

like https://github.com/ownstats/ownstats/blob/c045e22fcccbb3c43fa39fa60477a6dd26e9d1e0/client/src/plugins/ownstats/index.js + https://github.com/ownstats/ownstats/blob/c045e22fcccbb3c43fa39fa60477a6dd26e9d1e0/backend/resources/cf-distribution.yml#L8

Fields https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/real-time-logs.html#create-real-time-log-config

Realtime log includes `X-Api-Key:pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx`

```
1759687234.191	32.142.164.10	65.8.177.136	0.253	200	783	GET	https	d3o60fb1dwgq5k.cloudfront.net	/example	201	SFO53-P9	HoIW-MaV1Qu7J5kwqnAYBNlsg4iI2MBYb5OXBfykwRAZpAqHmdWtQA==	d3o60fb1dwgq5k.cloudfront.net	0.253	HTTP/1.1	IPv4	vscode-restclient	-	-	-	Miss	-	TLSv1.3	TLS_AES_128_GCM_SHA256	Miss	-	-	application/json	102	-	-	63051	Miss	US	gzip,%20deflate,%20br	-	*	User-Agent:vscode-restclient%0AX-Api-Key:pfCCh7ygOr8Gwv8BoGWHG3NO54Csd4aZ6tz1wHBx%0AAccept-Encoding:gzip,%20deflate,%20br%0AHost:d3o60fb1dwgq5k.cloudfront.net%0ACloudfront-Is-Mobile-Viewer:false%0ACloudfront-Is-Tablet-Viewer:false%0ACloudfront-Is-Smarttv-Viewer:false%0ACloudfront-Is-Desktop-Viewer:true%0ACloudfront-Is-Ios-Viewer:false%0ACloudfront-Is-Android-Viewer:false%0ACloudfront-Viewer-Http-Version:1.1%0ACloudfront-Viewer-Country:US%0ACloudfront-Viewer-Country-Name:United%20States%0ACloudfront-Viewer-Country-Region:CA%0ACloudfront-Viewer-Country-Region-Name:California%0ACloudfront-Viewer-City:Corte%20Madera%0ACloudfront-Viewer-Postal-Code:94925%0ACloudfront-Viewer-Time-Zone:America/Los_Angeles%0ACloudfront-Viewer-Metro-Code:807%0ACloudfront-Viewer-Latitude:37.92490%0ACloudfront-Viewer-Longitude:-122.51000%0A	User-Agent%0AX-Api-Key%0AAccept-Encoding%0AHost%0ACloudfront-Is-Mobile-Viewer%0ACloudfront-Is-Tablet-Viewer%0ACloudfront-Is-Smarttv-Viewer%0ACloudfront-Is-Desktop-Viewer%0ACloudfront-Is-Ios-Viewer%0ACloudfront-Is-Android-Viewer%0ACloudfront-Viewer-Http-Version%0ACloudfront-Viewer-Country%0ACloudfront-Viewer-Country-Name%0ACloudfront-Viewer-Country-Region%0ACloudfront-Viewer-Country-Region-Name%0ACloudfront-Viewer-City%0ACloudfront-Viewer-Postal-Code%0ACloudfront-Viewer-Time-Zone%0ACloudfront-Viewer-Metro-Code%0ACloudfront-Viewer-Latitude%0ACloudfront-Viewer-Longitude%0ACloudfront-Forwarded-Proto%0ACloudfront-Viewer-Address%0ACloudfront-Viewer-Tls%0ACloudfront-Viewer-Asn%0AConnection%0A	26	0.232	0.232	7018
```