---
'@apollo/datasource-rest': minor
---

Add a new overridable method `shouldJSONSerializeBody` for customizing body serialization behavior. This method should return a `boolean` in order to inform RESTDataSource as to whether or not it should call `JSON.stringify` on the request body.
