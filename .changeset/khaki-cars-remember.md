---
'@apollo/datasource-rest': major
---

Remove `didReceiveResponse` hook

The naming of this hook is deceiving; if this hook is overridden it becomes
responsible for returning the parsed body and handling errors if they occur. It
was originally introduced in
https://github.com/apollographql/apollo-server/issues/1324, where the author
implemented it due to lack of access to the complete response (headers) in the
fetch methods (get, post, ...). This approach isn't a type safe way to
accomplish this and places the burden of body parsing and error handling on the
user.

Removing this hook is a prerequisite to a subsequent change that will introduce
the ability to fetch a complete response (headers included) aside from the
provided fetch methods which only return a body. This change will reinstate the
functionality that the author of this hook had originally intended in a more
direct manner.
