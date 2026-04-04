---
name: domain-attachment
description: Attach a domain to an application after deployment. Covers auto-generated subdomains, existing domain selection, and custom domain setup with DNS configuration and verification.
metadata:
  version: "1.0"
---

# Domain Attachment

After a successful deployment, the app needs a domain to be reachable. Follow this flow.

## Step 1: Gather Options

- Call `get_domains` to list available domains.
- Call `generate_random_subdomain` to get a subdomain suggestion.

## Step 2: Present Options

- If only one domain exists, attach it automatically with `add_application_domain`.
- If multiple domains exist, present the list and ask the user which to use.
- Always offer the generated subdomain as a quick option (works immediately, no DNS setup needed).
- Ask if the user wants to use a custom domain instead.

## Step 3: Auto-Generated Subdomain (fast path)

If the user picks the generated subdomain:

1. Call `add_application_domain` with the subdomain.
2. Done — wildcard DNS and TLS are handled automatically.

## Step 4: Custom Domain Setup

If the user wants a custom domain (e.g. `app.example.com`):

1. Call `create_domain` with the domain name.
2. The response includes DNS setup instructions. Relay them clearly to the user:
   - **CNAME record**: point the domain to their assigned `subdomain.nixopus.ai`
   - **TXT record**: `_nixopus-verify.{domain}` with the verification value from the response
3. Tell the user to add both records at their DNS provider (Cloudflare, Namecheap, Route53, GoDaddy, etc.).
4. After the user confirms DNS is configured, call `update_domain` with the domain ID to verify.
5. If verification succeeds, call `add_application_domain` to attach the domain.
6. If verification fails:
   - DNS propagation can take minutes to 48 hours depending on the provider.
   - Suggest the user wait and retry, or check their DNS records are correct.
   - For deeper troubleshooting: `read_skill("domain-tls-routing")`.

## Common DNS Provider Notes

| Provider | Propagation | Notes |
|----------|-------------|-------|
| Cloudflare | Near-instant | Disable orange cloud (proxy) for the CNAME initially so verification passes |
| Namecheap | 5-30 minutes | Use "CNAME Record" type, host = subdomain part only |
| Route53 | 60 seconds | Standard CNAME + TXT |
| GoDaddy | Up to 48 hours | Slowest propagation |

## Important

- Never skip domain attachment — a deployed app without a domain is not reachable.
- For Compose apps, `add_application_domain` accepts an optional `service_name` and `port` to route to a specific service.
