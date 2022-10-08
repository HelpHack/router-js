import HealthController from './HealthController'

describe("HealthController", () => {
  it("Should return OK status when every provider is health", async () => {
    // GIVEN
    const providers = {
      providerA: async () => ({status: 'OK'}),
      providerB: async () => ({status: 'OK'}),
    };

    const controller = new HealthController(providers);

    // WHEN
    const result = await controller.getHealthRaw();

    // THEN
    expect(result.statusCode).toEqual(200);
    expect(result.body.status).toEqual('OK');

  });

  it("Should return DOWN status when any provider is unhealthy", async () => {
    // GIVEN
    const providers = {
      providerA: async () => ({status: 'OK'}),
      providerB: async () => ({status: 'DOWN', reason: 'broken'}),
    };

    const controller = new HealthController(providers);

    // WHEN
    const result = await controller.getHealthRaw();

    // THEN
    expect(result.statusCode).toEqual(500);
    expect(result.body.status).toEqual('DOWN');

  });


  it("Should return DOWN status when any provider is failing", async () => {
    // GIVEN
    const providers = {
      providerA: async () => ({status: 'OK'}),
      providerB: async () => { throw {status: 'broken'}; },
    };

    const controller = new HealthController(providers);

    // WHEN
    const result = await controller.getHealthRaw();

    // THEN
    expect(result.statusCode).toEqual(500);
    expect(result.body.status).toEqual('DOWN');

  });
});
