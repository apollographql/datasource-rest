---
'@apollo/datasource-rest': minor
---

Customize the logger used by `RESTDataSource`.
By default the `RESTDataSource` will use `console`.
Common use cases would be to override the default logger with `pino` or `winston`.

E.g.
```typescript
const pino = require('pino');
const loggerPino = pino({});
const dataSource = new (class extends RESTDataSource {})({
  logger: loggerPino,
});
```

All logging calls made by the `RESTDataSource` will now use the `pino` logger instead of the `console` logger.
