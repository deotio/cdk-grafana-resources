# Architecture

A single Lambda function per stack handles all Grafana resource types. The Lambda:

- Retrieves the API token from Secrets Manager (cached per invocation, cleared between invocations to support rotation)
- Downloads large payloads (dashboard JSON, contact point settings) from S3 assets
- Calls the Grafana HTTP API with retry logic (exponential backoff for 5xx/network errors, fail-fast on 4xx)
- Returns CloudFormation-compatible responses
