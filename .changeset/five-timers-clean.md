---
'@apollo/datasource-rest': minor
---

Provide head() HTTP helper method

Some REST APIs make use of HEAD requests. It seems reasonable for us to provide this method as we do the others.

It's worth noting that the API differs from the other helpers. While bodies are expected/allowed for other requests, that is explicitly not the case for HEAD requests. This method returns the request object itself rather than a parsed body so that useful information can be extracted from the headers.
