const Router = require("./Router.js");

const mockBroadcastHandler = jest.fn();

describe("Kadro router", () => {
  let router;

  beforeAll(async () => {
    router = new Router();
    router.get("testQueue", "/test1/:param1", data => data);
    router.get("testQueue", "/test1/:param1/values", data => data);
    router.get(
      "testQueue",
      "/test1/:param1/values/:param2/something/:param3",
      data => data
    );
    router.get("testQueue2", "/test1/:param1", data => data);
    router.post("testQueue", "/test1/:param1", data => data);
    router.put("testQueue", "/test1/:param1", data => data);
    router.delete("testQueue", "/test1/:param1", data => data);
    router.broadcast("testBroadcast", ["shift.delete"], (data) => mockBroadcastHandler(data));
  });

  afterAll(() => {});

  it("should handle GET requests", async () => {
    // WHEN
    const r1 = await router.handleRequest(
      { method: "GET", path: "/test1/123?from=2018-01-01" },
      "testQueue"
    );
    const r2 = await router.handleRequest(
      { method: "GET", path: "/test1/testerek?from=2018-01-01&to=2018-01-30" },
      "testQueue"
    );

    const r3 = await router.handleRequest(
      {
        method: "GET",
        path: "/test1/test1/values/test2/something/test3?test=true"
      },
      "testQueue"
    );

    // THEN
    expect(r1).toEqual({
      fullPaht: "/test1/123?from=2018-01-01",
      fullPath: "/test1/123?from=2018-01-01",
      method: "GET",
      params: { param1: "123" },
      path: "/test1/123",
      query: { from: "2018-01-01" }
    });

    expect(r2).toEqual({
      fullPaht: "/test1/testerek?from=2018-01-01&to=2018-01-30",
      fullPath: "/test1/testerek?from=2018-01-01&to=2018-01-30",
      method: "GET",
      params: { param1: "testerek" },
      path: "/test1/testerek",
      query: { from: "2018-01-01", to: "2018-01-30" }
    });

    expect(r3).toEqual({
      fullPaht: "/test1/test1/values/test2/something/test3?test=true",
      fullPath: "/test1/test1/values/test2/something/test3?test=true",
      method: "GET",
      params: { param1: "test1", param2: "test2", param3: "test3" },
      path: "/test1/test1/values/test2/something/test3",
      query: { test: "true" }
    });
  });

  it("should handle multiple queues", async () => {
    // WHEN
    const r1 = await router.handleRequest(
      { method: "GET", path: "/test1/123?from=2018-01-01" },
      "testQueue2"
    );

    // THEN
    expect(r1).toEqual({
      fullPaht: "/test1/123?from=2018-01-01",
      fullPath: "/test1/123?from=2018-01-01",
      method: "GET",
      params: { param1: "123" },
      path: "/test1/123",
      query: { from: "2018-01-01" }
    });
  });

  it("should handle POST requests", async () => {
    // WHEN
    const r1 = await router.handleRequest(
      { method: "POST", path: "/test1/123" },
      "testQueue"
    );

    // THEN
    expect(r1).toEqual({
      fullPaht: "/test1/123",
      fullPath: "/test1/123",
      method: "POST",
      params: { param1: "123" },
      path: "/test1/123",
      query: {}
    });
  });

  it("should handle PUT requests", async () => {
    // WHEN
    const r1 = await router.handleRequest(
      { method: "PUT", path: "/test1/123" },
      "testQueue"
    );

    // THEN
    expect(r1).toEqual({
      fullPaht: "/test1/123",
      fullPath: "/test1/123",
      method: "PUT",
      params: { param1: "123" },
      path: "/test1/123",
      query: {}
    });
  });

  it("should handle DELETE requests", async () => {
    // WHEN
    const r1 = await router.handleRequest(
      { method: "DELETE", path: "/test1/123" },
      "testQueue"
    );

    // THEN
    expect(r1).toEqual({
      fullPaht: "/test1/123",
      fullPath: "/test1/123",
      method: "DELETE",
      params: { param1: "123" },
      path: "/test1/123",
      query: {}
    });
  });

  it("should return 404 for unknown routes", async () => {
    // WHEN
    const r1 = await router.handleRequest(
      { method: "GET", path: "/unknown/123" },
      "testQueue"
    );

    // THEN
    expect(r1).toEqual({ data: { error: "not found" }, statusCode: 404 });
  });
});
