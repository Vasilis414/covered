curl -X POST https://covered-scan.vas93333.workers.dev/storage/upload \
  -H "Authorization: Bearer $(npx wrangler secret get DEV_ACCESS_TOKEN 2>/dev/null)" \
  -H "Content-Type: application/json" \
  -d '{"name":"test.jpg","mimeType":"image/jpeg","content":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="}'
