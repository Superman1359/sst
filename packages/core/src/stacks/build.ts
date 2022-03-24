import { Config } from "../config";
import * as esbuild from "esbuild";
import fs from "fs-extra";
import { State } from "..";
import path from "path";

export async function build(root: string, config: Config) {
  const buildDir = State.stacksPath(root);
  const pkg = await fs.readJson(path.join(root, "package.json"));
  const entry = path.join(root, config.main);
  if (!fs.existsSync(entry))
    throw new Error(
      `Cannot find app handler. Make sure to add a "${config.main}" file`
    );

  await esbuild.build({
    external: [
      "aws-cdk-lib",
      ...Object.keys({
        ...pkg.devDependencies,
        ...pkg.dependencies,
        ...pkg.peerDependencies,
      }),
    ],
    keepNames: true,
    bundle: true,
    format: "cjs",
    sourcemap: true,
    platform: "node",
    target: "node14",
    // The entry can have any file name (ie. "stacks/anything.ts"). We want the
    // build output to be always named "lib/index.js". This allow us to always
    // import from "buildDir" without needing to pass "anything" around.
    outfile: `${buildDir}/index.js`,
    entryPoints: [entry],
  });
}
