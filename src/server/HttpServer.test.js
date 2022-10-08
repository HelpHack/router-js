import HttpServer from './HttpServer'
import http from 'http';

function customHandler(req, res) {
  res.writeHead(418, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "☕" }));
}

function testHandler(req, res) {
  res.writeHead(203, { "Content-Type": "application/json" });
  res.end(JSON.stringify(req.query));
}

describe("HttpServer", () => {
    it("should listen for http requests", async (done) => {
        const server = new HttpServer(0);
        await server.start();
        const port = server.server.address().port;

        http.get(`http://localhost:${port}/healthz`, resp => {
            expect(resp.statusCode).toEqual(200);
            server.close().then(done).catch(done);
        })
    });

  it("should define default handler", async (done) => {
    const server = new HttpServer(0);
    await server.start();
    const port = server.server.address().port;

    http.get(`http://localhost:${port}/ashgsahsgsagasg`, resp => {
      expect(resp.statusCode).toEqual(404);
      server.close().then(done).catch(done);
    })
  });

  it("should support custom default handler", async (done) => {
    const server = new HttpServer(0, [], customHandler);
    await server.start();
    const port = server.server.address().port;

    http.get(`http://localhost:${port}/ashgsahsgsagasg`, resp => {
      expect(resp.statusCode).toEqual(418);
      server.close().then(done).catch(done);
    })
  });

  it("should support matching by path, without query", async (done) => {
    const server = new HttpServer(0);
    server.addRequestHandler('GET', '/test-handler', testHandler);
    await server.start();
    const port = server.server.address().port;
    http.get(`http://localhost:${port}/test-handler?from=2021-01-01&to=2021-02-30`, resp => {
      expect(resp.statusCode).toEqual(203);
      server.close().then(done).catch(done);
    });
  });
});
