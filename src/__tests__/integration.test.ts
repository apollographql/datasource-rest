import { ApolloServer } from '@apollo/server';
import { RESTDataSource } from '../RESTDataSource';

const typeDefs = `#graphql
  type Query {
    foo: String
  }

  type Mutation {
    createFoo: Int!
  }
`;

describe('Works with ApolloServer', () => {
  it('DataSources can be passed via `executeOperation` context argument and used in a resolver ', async () => {
    let fooPosted = false;
    class FooDS extends RESTDataSource {
      override baseURL = 'https://api.example.com';

      postFoo(foo: { id: number }) {
        fooPosted = true;
        return foo.id;
      }
    }

    interface MyContext {
      dataSources: {
        foo: FooDS;
      };
    }

    const server = new ApolloServer<MyContext>({
      typeDefs,
      resolvers: {
        Mutation: {
          createFoo(_, __, context) {
            return context.dataSources.foo.postFoo({ id: 1 });
          },
        },
      },
    });
    await server.start();

    const context: MyContext = {
      dataSources: {
        foo: new FooDS(),
      },
    };

    const res = await server.executeOperation(
      {
        query: `#graphql
          mutation { createFoo }
        `,
      },
      context,
    );

    expect(fooPosted).toBe(true);
    expect(res.result.data?.createFoo).toBe(1);
  });
});
