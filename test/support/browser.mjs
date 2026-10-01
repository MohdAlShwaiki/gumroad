import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const require = createRequire(process.env.PLAYWRIGHT_MODULES || '/opt/node22/lib/node_modules/');
export const { chromium } = require('playwright');

/**
 * Launch Chromium. In sandboxes that inspect HTTPS through a proxy CA, trust exactly that CA by its
 * public-key hash (equivalent to importing it). TLS verification stays ON for everything else.
 */
export function launch() {
  const args = [];
  const ca = process.env.PROXY_CA || '/root/.ccr/agent-proxy-ca.crt';
  if (existsSync(ca)) {
    try {
      const pub = execFileSync('openssl', ['x509', '-in', ca, '-pubkey', '-noout']);
      const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub });
      const spki = execFileSync('openssl', ['dgst', '-sha256', '-binary'], { input: der }).toString('base64');
      args.push(`--ignore-certificate-errors-spki-list=${spki}`);
    } catch { /* no openssl: fall back to default trust */ }
  }
  return chromium.launch({ args });
}

import { mockImage } from './catalogue.mjs';

/** Serve the mock store's images (https://store.example/img/*) without any network access. */
export async function mockStore(context) {
  await context.route('https://store.example/img/**', (route) => {
    const label = new URL(route.request().url()).pathname.slice(5).replace('.svg', '');
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: mockImage(label) });
  });
}
