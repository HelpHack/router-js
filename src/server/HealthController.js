class HealthController {

    constructor(healthProviders) {
        this.healthProviders = healthProviders;
    }

    async nodeEndpoint(req, res) {
        const status = await this.getHealthRaw();
        res.writeHead(status.statusCode, { "Content-Type": "application/json;charset=utf-8" });
        res.end(JSON.stringify(status.body));
    }

    async getHealthRaw() {
        const healthStatuses = [];
        for (let providerName in this.healthProviders) {
            healthStatuses.push(await HealthController.checkHealth(providerName, this.healthProviders[providerName]));
        }

        const isOk = healthStatuses
            .map(it => it.status)
            .every(it => it === 'OK');

        const code = isOk ? 200 : 500;
        const status = isOk ? 'OK' : 'DOWN';

        return {
            statusCode: code,
            body: {
                status: status,
                statuses: healthStatuses
            }
        }
    }

    static async checkHealth(name, provider) {
      try {
          const status =  await provider();
          status.name = name;
          return status;
      } catch (e) {
          return {
              name: name,
              status: 'ERROR',
              description: "unexpected error"
          }
      }

    }
}

module.exports = HealthController;
