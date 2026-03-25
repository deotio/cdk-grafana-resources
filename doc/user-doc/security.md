# Security

- API tokens are resolved at deploy time from Secrets Manager and never stored in CloudFormation state
- Large and sensitive payloads are uploaded as S3 assets, not passed inline
- Grafana endpoint and UID inputs are validated at synth time and runtime to prevent SSRF and path traversal
- Authorization headers are never logged; error response bodies are truncated
- Lambda IAM permissions follow least-privilege (S3 read for assets, Secrets Manager read for tokens)
