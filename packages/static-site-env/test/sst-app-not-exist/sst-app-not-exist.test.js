const { runStartCommand } = require("../helpers");

test("sst-app-not-exist", async () => {
  const result = await runStartCommand(__dirname);

  expect(result).toContain("Cannot find an SST app in the parent directories");
});
