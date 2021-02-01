const { runBuildCommand, clearBuildOutput } = require("../helpers");

beforeEach(async () => {
  await clearBuildOutput(__dirname);
});

afterAll(async () => {
  await clearBuildOutput(__dirname);
});

/**
 * Test that the synth command ran successfully
 */
test("build-no-bundle-no-srcpath", async () => {
  const result = await runBuildCommand(__dirname);

  expect(result).toMatch(
    /Bundle value is not supported/
  );
});
