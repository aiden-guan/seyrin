# Perch (demo app)

A fictional booking product the demo customers write in about. It has two planted bugs:

1. **Pricing:** the Upgrade buttons do nothing (`public/pricing.js` reads the wrong data attribute).
2. **Sign-up:** email addresses with a `+` are rejected (`public/signup.js` email pattern).

`npm run demo:reset` (from the folder root) puts both bugs back after a fix.

```bash
node demo-app/server.mjs   # http://localhost:4480
```
