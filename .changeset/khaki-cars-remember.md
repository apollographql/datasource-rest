---
'@apollo/datasource-rest': major
---

Reduce responsibility of `didReceiveResponse` hook

The naming of this hook is deceiving; if this hook is overridden it becomes
responsible for returning the parsed body. It was originally introduced in
https://github.com/apollographql/apollo-server/issues/1324, where the author
claims they implemented it due to lack of access to the complete response
(headers) in the fetch methods (get, post, ...). This approach isn't a type safe
way to acoomplish this.

This hook is now just an observability hook which receives a clone of the
response and the request that was sent.

A change following this will introduce the ability to fetch a complete response
(headers included) aside from the provided fetch methods which only return a
body, which will reinstate the functionality that the author of this hook had
originally intended.
