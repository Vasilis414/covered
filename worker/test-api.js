const { execSync } = require('child_process');

async function run() {
  const tokenRaw = execSync('npx wrangler secret get DEV_ACCESS_TOKEN').toString();
  // But wait! wrangler secret get is not readable in output! Let me check if I can just use wrangler dev!
}
run();
