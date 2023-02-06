---
'@apollo/datasource-rest': patch
---

Update `http-cache-semantics` package to latest patch, resolving a security issue.

Unlike many security updates Apollo repos receive, this is an _actual_ (non-dev)
dependency of this package which means it is actually a user-facing security issue.

This security issue would only affect you if either:
* you pass untrusted (i.e. from your users) `cache-control` request headers
* you sending requests to untrusted REST server that might return malicious
  `cache-control` headers

Since `http-cache-semantics` is a careted (^) dependency in this package, the
security issue can (and might already) be resolved via a `package-lock.json`
update within your project (possibly triggered by `npm audit` or another
dependency update which has already updated its version of the package in
question). If `npm ls http-cache-semantics` reveals a tree of dependencies which
only include the `4.1.1` version (and no references to any previous versions)
then you are currently unaffected and this patch should have (for all intents
and purpose) no effect.

More details available here: https://github.com/advisories/GHSA-rc47-6667-2j5j
