# Cloudflare DNS Setup for tscopier.ai

The domain `tscopier.ai` is registered at **Hostinger**. Nameservers can be changed in the Hostinger control panel.

## Status

- **Cloudflare account:** Created, domain added, all 34 DNS records imported and verified
- **DNS records:** All A, CNAME, MX, TXT, DKIM, SSL challenge records present (verified via dig against Cloudflare NS)
- **Proxy status:** Web A records proxied (orange cloud), email/DKIM/MX DNS only (grey cloud), staging CNAME DNS only
- **Nameservers:** NOT YET CHANGED — still on Netlify DNS (`dns1-dns4.p01.nsone.net`)

## How to Change Nameservers

Go to **Hostinger** → **Domains** → **tscopier.ai** → **DNS / Nameservers** → **Change nameservers** → replace with:
- `agustin.ns.cloudflare.com`
- `stevie.ns.cloudflare.com`

Save and wait for propagation (5 min - 48 hrs).

## DNS Records Summary

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| A | app | 13.52.188.95, 52.52.192.191 | Proxied |
| A | docs | 52.52.192.191, 13.52.188.95 | Proxied |
| A | tscopier.ai | 13.52.188.95, 52.52.192.191 | Proxied |
| A | www | 13.52.188.95, 52.52.192.191 | Proxied |
| CNAME | staging | legendary-valkyrie-4da363.netlify.app | DNS only |
| CNAME | sso | sxkpcovbyaficvtkpsdo.supabase.co | DNS only |
| CNAME | bounce.billing | custom-email-domain.stripe.com | DNS only |
| CNAME | hostingermail-a._domainkey | hostingermail-a.dkim.mail.hostinger.com | DNS only |
| CNAME | hostingermail-b._domainkey | hostingermail-b.dkim.mail.hostinger.com | DNS only |
| CNAME | hostingermail-c._domainkey | hostingermail-c.dkim.mail.hostinger.com | DNS only |
| CNAME | *._domainkey.billing (x6) | *.dkim.custom-email-domain.stripe.com | DNS only |
| MX | tscopier.ai (x4) | mail.dnsexit.com, mail2.dnsexit.com, mx1.hostinger.com, mx2.hostinger.com | DNS only |
| MX | send | feedback-smtp.us-east-1.amazonses.com | DNS only |
| TXT | _dmarc | v=DMARC1; p=none; | DNS only |
| TXT | _dmarc.billing | v=DMARC1; p=none; rua=mailto:report@tscopier.ai | DNS only |
| TXT | billing | stripe-verification=... | DNS only |
| TXT | resend._domainkey | (public key) | DNS only |
| TXT | send | v=spf1 include:amazonses.com | DNS only |
| TXT | tscopier.ai (x3) | google-site-verification, trustpilot, spf | DNS only |
| TXT | _acme-challenge.sso | (SSL verification) | DNS only |

## Verification

All records verified by querying Cloudflare nameservers directly:
```
dig @agustin.ns.cloudflare.com <record>.<domain> <type>
```
